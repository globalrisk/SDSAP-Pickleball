-- Player accounts are not administrators. Existing admin claims are unchanged.
DROP TRIGGER IF EXISTS assign_admin_role_to_new_user ON auth.users;
DROP FUNCTION IF EXISTS public.assign_admin_role_to_new_user();
CREATE SCHEMA IF NOT EXISTS pickle_private;
REVOKE ALL ON SCHEMA pickle_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.player_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  pool_player_id uuid NOT NULL UNIQUE REFERENCES public.player_pool(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_accounts_linked_by_idx ON public.player_accounts(linked_by);
CREATE TABLE public.pickle_wallets (
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  pool_player_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE RESTRICT,
  balance numeric(24,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id,pool_player_id)
);
CREATE INDEX pickle_wallets_player_idx ON public.pickle_wallets(pool_player_id);
ALTER TABLE public.matches ADD COLUMN betting_closed_at timestamptz;
-- Do not update immutable archived fixtures. Existing playing/resolved matches
-- are already ineligible; their first subsequent edit preserves closure below.
CREATE TABLE public.pickle_bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  creator_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE RESTRICT,
  acceptor_id uuid REFERENCES public.player_pool(id) ON DELETE RESTRICT,
  creator_side uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  home_team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  away_team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  home_ids uuid[] NOT NULL,
  away_ids uuid[] NOT NULL,
  creator_stake numeric(24,6) NOT NULL CHECK(creator_stake BETWEEN 1000 AND 1000000000000 AND mod(creator_stake,1000)=0),
  acceptor_stake numeric(24,6) NOT NULL CHECK(acceptor_stake BETWEEN 1000 AND 1000000000000 AND mod(acceptor_stake,1000)=0),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','accepted','review','settled','refunded','cancelled','void')),
  creator_request uuid NOT NULL,
  acceptor_request uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  close_reason text,
  CHECK(acceptor_id IS NULL OR acceptor_id<>creator_id),
  CHECK(creator_side IN (home_team_id,away_team_id)),
  UNIQUE(creator_id,creator_request), UNIQUE(acceptor_id,acceptor_request)
);
CREATE INDEX pickle_bets_match_idx ON public.pickle_bets(match_id);
CREATE INDEX pickle_bets_season_idx ON public.pickle_bets(season_id);
CREATE INDEX pickle_bets_league_state_idx ON public.pickle_bets(league_id,state,created_at DESC);
CREATE INDEX pickle_bets_creator_idx ON public.pickle_bets(creator_id,league_id,state);
CREATE INDEX pickle_bets_acceptor_idx ON public.pickle_bets(acceptor_id,league_id,state);
CREATE INDEX pickle_bets_creator_side_idx ON public.pickle_bets(creator_side);
CREATE INDEX pickle_bets_home_idx ON public.pickle_bets(home_team_id);
CREATE INDEX pickle_bets_away_idx ON public.pickle_bets(away_team_id);
CREATE TABLE public.pickle_bet_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  result_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  reason text NOT NULL,
  administrator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,revision)
);
CREATE INDEX pickle_settlements_league_idx ON public.pickle_bet_settlements(league_id);
CREATE INDEX pickle_settlements_admin_idx ON public.pickle_bet_settlements(administrator_id);
CREATE TABLE public.pickle_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL,
  pool_player_id uuid NOT NULL,
  amount numeric(24,6) NOT NULL,
  kind text NOT NULL CHECK(kind IN ('prize','bet','reversal')),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  bet_id uuid REFERENCES public.pickle_bets(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES public.pickle_bet_settlements(id) ON DELETE RESTRICT,
  reverses_id uuid UNIQUE REFERENCES public.pickle_transactions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(league_id,pool_player_id) REFERENCES public.pickle_wallets(league_id,pool_player_id) ON DELETE RESTRICT,
  CHECK((kind='prize' AND bet_id IS NULL AND settlement_id IS NULL AND reverses_id IS NULL)
    OR (kind='bet' AND bet_id IS NOT NULL AND settlement_id IS NOT NULL AND reverses_id IS NULL)
    OR (kind='reversal' AND bet_id IS NOT NULL AND settlement_id IS NOT NULL AND reverses_id IS NOT NULL))
);
CREATE UNIQUE INDEX pickle_transaction_prize_unique ON public.pickle_transactions(season_id,pool_player_id) WHERE kind='prize';
CREATE UNIQUE INDEX pickle_transaction_bet_unique ON public.pickle_transactions(settlement_id,bet_id,pool_player_id) WHERE kind='bet';
CREATE INDEX pickle_transactions_wallet_idx ON public.pickle_transactions(league_id,pool_player_id,created_at DESC);
CREATE INDEX pickle_transactions_player_idx ON public.pickle_transactions(pool_player_id);
CREATE INDEX pickle_transactions_season_idx ON public.pickle_transactions(season_id);
CREATE INDEX pickle_transactions_bet_idx ON public.pickle_transactions(bet_id);
CREATE INDEX pickle_transactions_settlement_idx ON public.pickle_transactions(settlement_id);

CREATE FUNCTION pickle_private.is_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT auth.uid() IS NOT NULL AND coalesce(auth.jwt()->'app_metadata'->>'role','')='admin' $$;
CREATE FUNCTION pickle_private.player_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT pool_player_id FROM public.player_accounts WHERE user_id=auth.uid() $$;
CREATE FUNCTION pickle_private.member(p_league uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.league_players WHERE league_id=p_league AND pool_player_id=pickle_private.player_id()) $$;
CREATE FUNCTION pickle_private.reserved(p_league uuid,p_player uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT coalesce(sum(CASE WHEN creator_id=p_player THEN creator_stake ELSE acceptor_stake END),0)
  FROM public.pickle_bets WHERE league_id=p_league AND (creator_id=p_player OR acceptor_id=p_player)
  AND state IN ('open','accepted','review')
$$;
CREATE FUNCTION pickle_private.require_admin() RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF NOT pickle_private.is_admin() THEN RAISE EXCEPTION 'BET_ADMIN: Administrator access required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION pickle_private.lock_match(p_match uuid) RETURNS public.matches
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE m public.matches; s public.seasons; BEGIN
  SELECT * INTO m FROM public.matches WHERE id=p_match;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_MATCH: Match not found'; END IF;
  SELECT * INTO s FROM public.seasons WHERE id=m.season_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:'||s.league_id::text,0));
  SELECT * INTO s FROM public.seasons WHERE id=m.season_id FOR UPDATE;
  SELECT * INTO m FROM public.matches WHERE id=p_match FOR UPDATE;
  IF s.status<>'active' OR (SELECT status FROM public.leagues WHERE id=s.league_id)<>'active' THEN
    RAISE EXCEPTION 'BET_FINAL: League and season must be active'; END IF;
  RETURN m;
END $$;
CREATE FUNCTION pickle_private.lock_wallets(p_league uuid,p_players uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE p uuid; BEGIN
  FOR p IN SELECT DISTINCT id FROM unnest(p_players) id WHERE id IS NOT NULL ORDER BY id LOOP
    INSERT INTO public.pickle_wallets(league_id,pool_player_id) VALUES(p_league,p) ON CONFLICT DO NOTHING;
    PERFORM 1 FROM public.pickle_wallets WHERE league_id=p_league AND pool_player_id=p FOR UPDATE;
  END LOOP;
END $$;
CREATE FUNCTION pickle_private.result_fingerprint(p_match public.matches) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT md5(jsonb_build_array(p_match.status,p_match.winner_team_id,p_match.home_score,p_match.away_score,p_match.home_team_id,p_match.away_team_id,p_match.home_pool_player_ids,p_match.away_pool_player_ids)::text) $$;
CREATE FUNCTION pickle_private.credit_wallet() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  UPDATE public.pickle_wallets SET balance=balance+NEW.amount WHERE league_id=NEW.league_id AND pool_player_id=NEW.pool_player_id;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_pickle_wallet AFTER INSERT ON public.pickle_transactions FOR EACH ROW EXECUTE FUNCTION pickle_private.credit_wallet();
CREATE FUNCTION pickle_private.credit_prize() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE league uuid; BEGIN
  SELECT league_id INTO league FROM public.pickle_awards WHERE season_id=NEW.season_id;
  PERFORM pickle_private.lock_wallets(league,ARRAY[NEW.pool_player_id]);
  INSERT INTO public.pickle_transactions(league_id,pool_player_id,amount,kind,season_id)
    VALUES(league,NEW.pool_player_id,NEW.amount,'prize',NEW.season_id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER credit_pickle_prize AFTER INSERT ON public.pickle_allocations FOR EACH ROW EXECUTE FUNCTION pickle_private.credit_prize();
INSERT INTO public.pickle_wallets(league_id,pool_player_id)
  SELECT DISTINCT r.league_id,a.pool_player_id FROM public.pickle_allocations a JOIN public.pickle_awards r ON r.season_id=a.season_id;
INSERT INTO public.pickle_transactions(league_id,pool_player_id,amount,kind,season_id)
  SELECT r.league_id,a.pool_player_id,a.amount,'prize',a.season_id FROM public.pickle_allocations a JOIN public.pickle_awards r ON r.season_id=a.season_id;

CREATE FUNCTION public.link_player_account(p_player_id uuid,p_email text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE u uuid; BEGIN
  PERFORM pickle_private.require_admin();
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_player_account_links',0));
  SELECT id INTO u FROM auth.users WHERE lower(email)=lower(trim(p_email));
  IF u IS NULL THEN RAISE EXCEPTION 'BET_ACCOUNT: No existing account with that email'; END IF;
  IF EXISTS(SELECT 1 FROM public.player_accounts WHERE (user_id=u OR pool_player_id=p_player_id) AND NOT(user_id=u AND pool_player_id=p_player_id)) THEN
    RAISE EXCEPTION 'BET_LINKED: Account or player already linked'; END IF;
  INSERT INTO public.player_accounts(user_id,pool_player_id,linked_by) VALUES(u,p_player_id,auth.uid()) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.player_accounts WHERE user_id=u AND pool_player_id=p_player_id) THEN RAISE EXCEPTION 'BET_LINKED: Account or player already linked'; END IF;
END $$;
CREATE FUNCTION public.my_player_account() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('playerId',p.id,'name',p.name) FROM public.player_accounts a JOIN public.player_pool p ON p.id=a.pool_player_id WHERE a.user_id=auth.uid()
$$;
CREATE FUNCTION public.league_player_accounts(p_league_id uuid) RETURNS TABLE(player_id uuid,email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
  PERFORM pickle_private.require_admin();
  RETURN QUERY SELECT a.pool_player_id,u.email::text FROM public.player_accounts a JOIN auth.users u ON u.id=a.user_id
    JOIN public.league_players l ON l.pool_player_id=a.pool_player_id WHERE l.league_id=p_league_id;
END $$;
CREATE FUNCTION public.pickle_wallet(p_league_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE p uuid:=pickle_private.player_id(); b numeric; r numeric; BEGIN
  IF p IS NULL OR NOT EXISTS(SELECT 1 FROM public.league_players WHERE league_id=p_league_id AND pool_player_id=p) THEN RAISE EXCEPTION 'BET_LINK: A linked league player account is required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(balance,0) INTO b FROM public.pickle_wallets WHERE league_id=p_league_id AND pool_player_id=p;
  b:=coalesce(b,0); r:=pickle_private.reserved(p_league_id,p);
  RETURN jsonb_build_object('balance',b::text,'reserved',r::text,'available',greatest(b-r,0)::text,'owed',greatest(-b,0)::text);
END $$;
CREATE FUNCTION pickle_private.eligible(p_league uuid,p_match public.matches,p_player uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF p_player IS NULL OR NOT EXISTS(SELECT 1 FROM public.league_players WHERE league_id=p_league AND pool_player_id=p_player AND status='active') THEN RAISE EXCEPTION 'BET_MEMBER: Active linked league membership required' USING ERRCODE='42501'; END IF;
  IF p_match.status<>'scheduled' OR p_match.betting_closed_at IS NOT NULL OR p_match.live_status='playing' THEN RAISE EXCEPTION 'BET_CLOSED: Betting is closed for this match'; END IF;
  IF p_player=ANY(public.league_match_participant_ids(p_match)) THEN RAISE EXCEPTION 'BET_SPECTATOR: Participants cannot bet on their own match'; END IF;
END $$;
CREATE FUNCTION public.create_pickle_bet(p_match_id uuid,p_side_id uuid,p_creator_stake numeric,p_acceptor_stake numeric,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE m public.matches; league uuid; p uuid:=pickle_private.player_id(); prior public.pickle_bets; result uuid; BEGIN
  IF p IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'BET_LINK: Linked account and request identifier required' USING ERRCODE='42501'; END IF;
  m:=pickle_private.lock_match(p_match_id); SELECT league_id INTO league FROM public.seasons WHERE id=m.season_id;
  SELECT * INTO prior FROM public.pickle_bets WHERE creator_id=p AND creator_request=p_request_id;
  IF FOUND THEN
    IF prior.match_id<>p_match_id OR prior.creator_side<>p_side_id OR prior.creator_stake<>p_creator_stake OR prior.acceptor_stake<>p_acceptor_stake THEN RAISE EXCEPTION 'BET_REQUEST: Request identifier reused with different terms'; END IF;
    RETURN prior.id;
  END IF;
  PERFORM pickle_private.eligible(league,m,p);
  IF cardinality(pickle_private.side_ids(m,true)) IS DISTINCT FROM 2 OR cardinality(pickle_private.side_ids(m,false)) IS DISTINCT FROM 2
    OR (SELECT count(DISTINCT id) FROM unnest(pickle_private.side_ids(m,true)||pickle_private.side_ids(m,false)) id)<>4 THEN RAISE EXCEPTION 'BET_LINEUP: Four valid players required'; END IF;
  IF p_side_id IS NULL OR p_side_id NOT IN(m.home_team_id,m.away_team_id) OR p_creator_stake IS NULL OR p_acceptor_stake IS NULL
    OR NOT(p_creator_stake BETWEEN 1000 AND 1000000000000 AND mod(p_creator_stake,1000)=0)
    OR NOT(p_acceptor_stake BETWEEN 1000 AND 1000000000000 AND mod(p_acceptor_stake,1000)=0) THEN RAISE EXCEPTION 'BET_AMOUNT: Positive multiples of 1,000 required'; END IF;
  PERFORM pickle_private.lock_wallets(league,ARRAY[p]);
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=league AND pool_player_id=p)-pickle_private.reserved(league,p)<p_creator_stake THEN RAISE EXCEPTION 'BET_FUNDS: Insufficient available points'; END IF;
  INSERT INTO public.pickle_bets(league_id,season_id,match_id,creator_id,creator_side,home_team_id,away_team_id,home_ids,away_ids,creator_stake,acceptor_stake,creator_request)
  VALUES(league,m.season_id,m.id,p,p_side_id,m.home_team_id,m.away_team_id,
    pickle_private.side_ids(m,true),pickle_private.side_ids(m,false),p_creator_stake,p_acceptor_stake,p_request_id) RETURNING id INTO result;
  RETURN result;
END $$;
CREATE FUNCTION public.accept_pickle_bet(p_bet_id uuid,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE b public.pickle_bets; m public.matches; p uuid:=pickle_private.player_id(); BEGIN
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id;
  IF NOT FOUND OR p IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'BET_LINK: Bet and linked account required' USING ERRCODE='42501'; END IF;
  m:=pickle_private.lock_match(b.match_id);
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id FOR UPDATE;
  IF b.acceptor_id=p AND b.acceptor_request=p_request_id THEN RETURN b.id; END IF;
  PERFORM pickle_private.eligible(b.league_id,m,p);
  IF b.state<>'open' OR b.creator_id=p THEN RAISE EXCEPTION 'BET_TAKEN: This offer is no longer available'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_players WHERE league_id=b.league_id AND pool_player_id=b.creator_id AND status='active') THEN RAISE EXCEPTION 'BET_MEMBER: Creator is no longer an active league member'; END IF;
  PERFORM pickle_private.lock_wallets(b.league_id,ARRAY[b.creator_id,p]);
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=b.league_id AND pool_player_id=p)-pickle_private.reserved(b.league_id,p)<b.acceptor_stake THEN RAISE EXCEPTION 'BET_FUNDS: Insufficient available points'; END IF;
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=b.league_id AND pool_player_id=b.creator_id)<pickle_private.reserved(b.league_id,b.creator_id) THEN RAISE EXCEPTION 'BET_FUNDS: Creator no longer has enough points'; END IF;
  UPDATE public.pickle_bets SET acceptor_id=p,acceptor_request=p_request_id,state='accepted',accepted_at=now(),updated_at=now() WHERE id=b.id;
  RETURN b.id;
END $$;
CREATE FUNCTION public.cancel_pickle_bet(p_bet_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE b public.pickle_bets; BEGIN
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id;
  IF NOT FOUND OR b.creator_id IS DISTINCT FROM pickle_private.player_id() THEN RAISE EXCEPTION 'BET_OWNER: Only the creator can cancel' USING ERRCODE='42501'; END IF;
  PERFORM pickle_private.lock_match(b.match_id);
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id FOR UPDATE;
  IF b.state='cancelled' THEN RETURN; END IF;
  IF b.state<>'open' THEN RAISE EXCEPTION 'BET_ACCEPTED: Accepted bets cannot be cancelled'; END IF;
  PERFORM pickle_private.lock_wallets(b.league_id,ARRAY[b.creator_id]);
  UPDATE public.pickle_bets SET state='cancelled',close_reason='creator',updated_at=now() WHERE id=b.id;
END $$;

CREATE FUNCTION pickle_private.side_ids(m public.matches,p_home boolean) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT array_agg(id ORDER BY id) FROM unnest(CASE
    WHEN cardinality(CASE WHEN p_home THEN m.home_pool_player_ids ELSE m.away_pool_player_ids END)=2
      THEN CASE WHEN p_home THEN m.home_pool_player_ids ELSE m.away_pool_player_ids END
    ELSE (SELECT array_agg(pool_player_id) FROM public.players WHERE team_id=CASE WHEN p_home THEN m.home_team_id ELSE m.away_team_id END)
  END) id
$$;
CREATE FUNCTION pickle_private.guard_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE league uuid; changed boolean; BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF OLD.betting_closed_at IS NOT NULL AND NEW.betting_closed_at IS DISTINCT FROM OLD.betting_closed_at THEN
    RAISE EXCEPTION 'BET_CLOSED: Betting cannot reopen'; END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id=OLD.season_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:'||league::text,0));
  PERFORM 1 FROM public.seasons WHERE id=OLD.season_id FOR UPDATE;
  changed:=NEW.season_id IS DISTINCT FROM OLD.season_id OR NEW.home_team_id IS DISTINCT FROM OLD.home_team_id OR NEW.away_team_id IS DISTINCT FROM OLD.away_team_id
    OR pickle_private.side_ids(NEW,true) IS DISTINCT FROM pickle_private.side_ids(OLD,true)
    OR pickle_private.side_ids(NEW,false) IS DISTINCT FROM pickle_private.side_ids(OLD,false);
  IF (SELECT status FROM public.seasons WHERE id=OLD.season_id)='archived' AND EXISTS(SELECT 1 FROM public.pickle_bets WHERE match_id=OLD.id)
    AND (changed OR pickle_private.result_fingerprint(NEW)<>pickle_private.result_fingerprint(OLD)) THEN RAISE EXCEPTION 'BET_FINAL: Archived bet results are final'; END IF;
  IF EXISTS(SELECT 1 FROM public.pickle_bet_settlements WHERE match_id=OLD.id) AND
    (changed OR pickle_private.result_fingerprint(NEW)<>pickle_private.result_fingerprint(OLD)) AND NOT EXISTS(
      SELECT 1 FROM pickle_private.correction_context WHERE transaction_id=txid_current() AND match_id=OLD.id) THEN
    RAISE EXCEPTION 'BET_CORRECTION: Use the reviewed bet correction flow'; END IF;
  IF changed THEN
    IF EXISTS(SELECT 1 FROM public.pickle_bets WHERE match_id=OLD.id AND state IN('settled','refunded')) THEN RAISE EXCEPTION 'BET_LINEUP: Settled bet lineups cannot change'; END IF;
    UPDATE public.pickle_bets SET state='void',close_reason='lineup',updated_at=now() WHERE match_id=OLD.id AND state IN('open','accepted','review');
  END IF;
  IF NEW.status<>'scheduled' OR NEW.live_status='playing' OR OLD.status<>'scheduled' OR OLD.live_status='playing' THEN
    NEW.betting_closed_at:=coalesce(OLD.betting_closed_at,now());
    UPDATE public.pickle_bets SET state='cancelled',close_reason='match_closed',updated_at=now() WHERE match_id=OLD.id AND state='open';
  END IF;
  UPDATE public.pickle_bets SET state=CASE WHEN NEW.status='scheduled' THEN 'accepted' ELSE 'review' END,updated_at=now()
    WHERE match_id=OLD.id AND state IN('accepted','review');
  RETURN NEW;
END $$;
-- A private table prevents callers forging a custom-GUC correction bypass.
CREATE TABLE pickle_private.correction_context(transaction_id bigint NOT NULL,match_id uuid NOT NULL,PRIMARY KEY(transaction_id,match_id));
REVOKE ALL ON pickle_private.correction_context FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ab_guard_pickle_bets BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION pickle_private.guard_match();
CREATE FUNCTION pickle_private.guard_roster_bets() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE team uuid; league uuid; BEGIN
  IF TG_OP='UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id AND NEW.pool_player_id IS NOT DISTINCT FROM OLD.pool_player_id THEN RETURN NEW; END IF;
  FOR team IN SELECT DISTINCT id FROM unnest(ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.team_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.team_id END]) id WHERE id IS NOT NULL ORDER BY id LOOP
    SELECT s.league_id INTO league FROM public.teams t JOIN public.seasons s ON s.id=t.season_id WHERE t.id=team;
    PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:'||league::text,0));
    IF EXISTS(SELECT 1 FROM public.pickle_bets b JOIN public.matches m ON m.id=b.match_id WHERE (b.home_team_id=team OR b.away_team_id=team) AND b.state IN('settled','refunded') AND
      (b.home_ids IS DISTINCT FROM pickle_private.side_ids(m,true) OR b.away_ids IS DISTINCT FROM pickle_private.side_ids(m,false))) THEN RAISE EXCEPTION 'BET_LINEUP: Settled bet lineups cannot change'; END IF;
    UPDATE public.pickle_bets b SET state='void',close_reason='lineup',updated_at=now() FROM public.matches m WHERE m.id=b.match_id AND (b.home_team_id=team OR b.away_team_id=team)
      AND b.state IN('open','accepted','review') AND (b.home_ids IS DISTINCT FROM pickle_private.side_ids(m,true) OR b.away_ids IS DISTINCT FROM pickle_private.side_ids(m,false));
  END LOOP;
  RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER guard_pickle_roster AFTER INSERT OR UPDATE OR DELETE ON public.players FOR EACH ROW EXECUTE FUNCTION pickle_private.guard_roster_bets();
CREATE FUNCTION pickle_private.guard_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NEW.status='archived' AND OLD.status<>'archived' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:'||OLD.league_id::text,0));
    IF EXISTS(SELECT 1 FROM public.pickle_bets WHERE season_id=OLD.id AND state IN('accepted','review')) THEN RAISE EXCEPTION 'BET_REVIEW: Confirm or refund all accepted bets before archiving'; END IF;
    UPDATE public.pickle_bets SET state='cancelled',close_reason='season_archived',updated_at=now() WHERE season_id=OLD.id AND state='open';
  END IF;
  IF OLD.status='archived' AND NEW.status<>'archived' AND EXISTS(SELECT 1 FROM public.pickle_bets WHERE season_id=OLD.id) THEN RAISE EXCEPTION 'BET_FINAL: A season with archived bets cannot reopen'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ab_guard_bet_archive BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION pickle_private.guard_archive();
CREATE FUNCTION pickle_private.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'BET_IMMUTABLE: Financial records are immutable'; END $$;
CREATE TRIGGER immutable_pickle_transactions BEFORE UPDATE OR DELETE ON public.pickle_transactions FOR EACH ROW EXECUTE FUNCTION pickle_private.immutable();
CREATE TRIGGER immutable_pickle_settlements BEFORE UPDATE OR DELETE ON public.pickle_bet_settlements FOR EACH ROW EXECUTE FUNCTION pickle_private.immutable();
CREATE TRIGGER immutable_player_accounts BEFORE UPDATE OR DELETE ON public.player_accounts FOR EACH ROW EXECUTE FUNCTION pickle_private.immutable();

CREATE FUNCTION public.pickle_settlement_preview(p_match_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE m public.matches; revision integer; bets jsonb; BEGIN
  PERFORM pickle_private.require_admin();
  SELECT * INTO m FROM public.matches WHERE id=p_match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BET_MATCH: Match not found'; END IF;
  IF m.status NOT IN('completed','forfeit') OR m.winner_team_id IS NULL OR m.winner_team_id NOT IN(m.home_team_id,m.away_team_id) THEN RAISE EXCEPTION 'BET_RESULT: A valid completed result is required'; END IF;
  SELECT coalesce(max(s.revision),0) INTO revision FROM public.pickle_bet_settlements s WHERE match_id=m.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'creatorId',b.creator_id,'creatorName',p.name,'creatorSide',b.creator_side,'acceptorId',b.acceptor_id,'acceptorName',a.name,'creatorStake',b.creator_stake::text,'acceptorStake',b.acceptor_stake::text,
    'creatorNet',(CASE WHEN m.status='forfeit' THEN 0 WHEN m.winner_team_id=b.creator_side THEN b.acceptor_stake ELSE -b.creator_stake END)::text,
    'acceptorNet',(CASE WHEN m.status='forfeit' THEN 0 WHEN m.winner_team_id=b.creator_side THEN -b.acceptor_stake ELSE b.creator_stake END)::text) ORDER BY b.created_at,b.id),'[]'::jsonb) INTO bets
    FROM public.pickle_bets b JOIN public.player_pool p ON p.id=b.creator_id JOIN public.player_pool a ON a.id=b.acceptor_id WHERE b.match_id=m.id AND b.state IN('accepted','review','settled','refunded');
  RETURN jsonb_build_object('matchId',m.id,'fingerprint',pickle_private.result_fingerprint(m),'revision',revision,'status',m.status,'winnerId',m.winner_team_id,'homeScore',m.home_score,'awayScore',m.away_score,'bets',bets);
END $$;
CREATE FUNCTION pickle_private.settle(p_match uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$ DECLARE m public.matches; b public.pickle_bets; prior public.pickle_bet_settlements; receipt uuid; league uuid; rev integer; net numeric; BEGIN
  SELECT * INTO m FROM public.matches WHERE id=p_match;
  IF m.status NOT IN('completed','forfeit') OR m.winner_team_id IS NULL OR m.winner_team_id NOT IN(m.home_team_id,m.away_team_id) THEN RAISE EXCEPTION 'BET_RESULT: A valid completed result is required'; END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id=m.season_id;
  SELECT * INTO prior FROM public.pickle_bet_settlements WHERE match_id=m.id ORDER BY revision DESC LIMIT 1;
  IF FOUND AND prior.result_fingerprint=pickle_private.result_fingerprint(m) THEN RETURN prior.id; END IF;
  IF prior.id IS NULL AND NOT EXISTS(SELECT 1 FROM public.pickle_bets WHERE match_id=m.id AND state IN('accepted','review')) THEN RAISE EXCEPTION 'BET_EMPTY: No accepted bets to confirm'; END IF;
  rev:=coalesce(prior.revision,0)+1;
  PERFORM pickle_private.lock_wallets(league,ARRAY(SELECT id FROM (
    SELECT creator_id id FROM public.pickle_bets WHERE match_id=m.id UNION SELECT acceptor_id FROM public.pickle_bets WHERE match_id=m.id) q));
  INSERT INTO public.pickle_bet_settlements(match_id,league_id,revision,result_fingerprint,result,reason,administrator_id)
    VALUES(m.id,league,rev,pickle_private.result_fingerprint(m),to_jsonb(m),p_reason,auth.uid()) RETURNING id INTO receipt;
  IF prior.id IS NOT NULL THEN
    INSERT INTO public.pickle_transactions(league_id,pool_player_id,amount,kind,season_id,bet_id,settlement_id,reverses_id)
      SELECT league_id,pool_player_id,-amount,'reversal',season_id,bet_id,receipt,id FROM public.pickle_transactions WHERE settlement_id=prior.id AND kind='bet';
  END IF;
  FOR b IN SELECT * FROM public.pickle_bets WHERE match_id=m.id AND state IN('accepted','review','settled','refunded') ORDER BY id FOR UPDATE LOOP
    IF b.home_ids IS DISTINCT FROM pickle_private.side_ids(m,true) OR b.away_ids IS DISTINCT FROM pickle_private.side_ids(m,false) THEN RAISE EXCEPTION 'BET_LINEUP: Bet lineup no longer matches'; END IF;
    net:=CASE WHEN m.status='forfeit' THEN 0 WHEN m.winner_team_id=b.creator_side THEN b.acceptor_stake ELSE -b.creator_stake END;
    INSERT INTO public.pickle_transactions(league_id,pool_player_id,amount,kind,season_id,bet_id,settlement_id) VALUES
      (league,b.creator_id,net,'bet',b.season_id,b.id,receipt),(league,b.acceptor_id,-net,'bet',b.season_id,b.id,receipt);
    UPDATE public.pickle_bets SET state=CASE WHEN m.status='forfeit' THEN 'refunded' ELSE 'settled' END,updated_at=now() WHERE id=b.id;
  END LOOP;
  -- Remove all unaccepted offers for wallets which are no longer fully funded.
  UPDATE public.pickle_bets offer SET state='cancelled',close_reason='correction_funds',updated_at=now() WHERE league_id=league AND state='open' AND EXISTS(
    SELECT 1 FROM public.pickle_wallets w WHERE w.league_id=league AND w.pool_player_id=offer.creator_id AND w.balance<pickle_private.reserved(league,offer.creator_id));
  RETURN receipt;
END $$;
CREATE FUNCTION public.confirm_pickle_settlement(p_match_id uuid,p_fingerprint text,p_revision integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE m public.matches; prior public.pickle_bet_settlements; BEGIN
  PERFORM pickle_private.require_admin(); m:=pickle_private.lock_match(p_match_id);
  SELECT * INTO prior FROM public.pickle_bet_settlements WHERE match_id=m.id ORDER BY revision DESC LIMIT 1;
  IF prior.id IS NOT NULL AND prior.result_fingerprint=p_fingerprint AND pickle_private.result_fingerprint(m)=p_fingerprint AND prior.revision=p_revision+1 THEN RETURN prior.id; END IF;
  IF p_fingerprint IS NULL OR p_fingerprint<>pickle_private.result_fingerprint(m) OR p_revision IS DISTINCT FROM coalesce(prior.revision,0) THEN RAISE EXCEPTION 'BET_STALE: Result or payout changed; review again' USING ERRCODE='40001'; END IF;
  RETURN pickle_private.settle(m.id,'confirmed');
END $$;
CREATE FUNCTION public.correct_pickle_match_result(
  p_league_id uuid,p_match_id uuid,p_status text,p_winner_team_id uuid,p_home_score integer,p_away_score integer,
  p_home_pool_player_ids uuid[],p_away_pool_player_ids uuid[],p_result_recorded_at timestamptz,
  p_history_rows jsonb,p_player_ratings jsonb,p_expected_revision bigint,p_reason text,p_result_fingerprint text,p_settlement_revision integer,p_request_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE m public.matches; revision integer; request_fingerprint text; prior_request record; BEGIN
  PERFORM pickle_private.require_admin(); m:=pickle_private.lock_match(p_match_id);
  IF p_reason IS NULL OR length(trim(p_reason))<3 OR p_request_id IS NULL THEN RAISE EXCEPTION 'BET_REASON: Correction reason and request identifier required'; END IF;
  IF (SELECT league_id FROM public.seasons WHERE id=m.season_id) IS DISTINCT FROM p_league_id THEN RAISE EXCEPTION 'BET_LEAGUE: Wrong league'; END IF;
  request_fingerprint:=md5(jsonb_build_array(p_match_id,p_status,p_winner_team_id,p_home_score,p_away_score,p_home_pool_player_ids,p_away_pool_player_ids,trim(p_reason),p_result_fingerprint,p_settlement_revision)::text);
  SELECT * INTO prior_request FROM pickle_private.correction_requests WHERE request_id=p_request_id;
  IF FOUND THEN
    IF prior_request.match_id<>p_match_id OR prior_request.actor<>auth.uid() OR prior_request.fingerprint<>request_fingerprint THEN RAISE EXCEPTION 'BET_REQUEST: Request identifier reused with different correction'; END IF;
    RETURN;
  END IF;
  SELECT coalesce(max(s.revision),0) INTO revision FROM public.pickle_bet_settlements s WHERE match_id=m.id;
  IF p_result_fingerprint IS NULL OR p_result_fingerprint<>pickle_private.result_fingerprint(m) OR revision IS DISTINCT FROM p_settlement_revision THEN RAISE EXCEPTION 'BET_STALE: Result or payout changed; review again' USING ERRCODE='40001'; END IF;
  IF revision=0 OR p_status NOT IN('completed','forfeit') OR p_winner_team_id IS NULL OR p_winner_team_id NOT IN(m.home_team_id,m.away_team_id) THEN RAISE EXCEPTION 'BET_RESULT: Correct an already confirmed match with a valid result'; END IF;
  IF p_status='completed' AND (p_home_score IS NULL OR p_away_score IS NULL OR p_home_score<0 OR p_away_score<0 OR p_home_score=p_away_score OR ((p_home_score>p_away_score) IS DISTINCT FROM (p_winner_team_id=m.home_team_id))) THEN RAISE EXCEPTION 'BET_RESULT: Scores do not match winner'; END IF;
  IF p_home_pool_player_ids IS DISTINCT FROM m.home_pool_player_ids OR p_away_pool_player_ids IS DISTINCT FROM m.away_pool_player_ids THEN RAISE EXCEPTION 'BET_LINEUP: Correction cannot change players'; END IF;
  INSERT INTO pickle_private.correction_context VALUES(txid_current(),m.id);
  PERFORM public.save_match_and_ratings_atomic(p_league_id,p_match_id,p_status,p_winner_team_id,p_home_score,p_away_score,p_home_pool_player_ids,p_away_pool_player_ids,p_result_recorded_at,p_history_rows,p_player_ratings,p_expected_revision);
  PERFORM pickle_private.settle(m.id,trim(p_reason));
  DELETE FROM pickle_private.correction_context WHERE transaction_id=txid_current() AND match_id=m.id;
  INSERT INTO pickle_private.correction_requests VALUES(p_request_id,m.id,auth.uid(),request_fingerprint);
END $$;
CREATE TABLE pickle_private.correction_requests(request_id uuid PRIMARY KEY,match_id uuid NOT NULL,actor uuid NOT NULL,fingerprint text NOT NULL);
REVOKE ALL ON pickle_private.correction_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pickle_bets_list(p_league_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF NOT pickle_private.member(p_league_id) AND NOT pickle_private.is_admin() THEN RAISE EXCEPTION 'BET_MEMBER: Active league membership required' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'seasonId',b.season_id,'matchId',b.match_id,'creatorId',b.creator_id,'creatorName',p.name,'acceptorId',b.acceptor_id,'acceptorName',a.name,'creatorSide',b.creator_side,
    'homeTeamId',b.home_team_id,'awayTeamId',b.away_team_id,'homeNames',ARRAY(SELECT name FROM public.player_pool WHERE id=ANY(b.home_ids) ORDER BY id),'awayNames',ARRAY(SELECT name FROM public.player_pool WHERE id=ANY(b.away_ids) ORDER BY id),
    'creatorStake',b.creator_stake::text,'acceptorStake',b.acceptor_stake::text,'state',b.state,'createdAt',b.created_at,'closeReason',b.close_reason) ORDER BY b.created_at DESC,b.id)
    FROM public.pickle_bets b JOIN public.player_pool p ON p.id=b.creator_id LEFT JOIN public.player_pool a ON a.id=b.acceptor_id WHERE b.league_id=p_league_id),'[]'::jsonb);
END $$;
CREATE FUNCTION public.pickle_wallet_history(p_league_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE p uuid:=pickle_private.player_id(); BEGIN
  IF p IS NULL OR NOT EXISTS(SELECT 1 FROM public.league_players WHERE league_id=p_league_id AND pool_player_id=p) THEN RAISE EXCEPTION 'BET_LINK: Linked league membership required' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'amount',t.amount::text,'kind',t.kind,'seasonName',s.name,'betId',t.bet_id,'matchId',r.match_id,'revision',r.revision,'reason',r.reason,'createdAt',t.created_at) ORDER BY t.created_at DESC,t.id)
    FROM public.pickle_transactions t JOIN public.seasons s ON s.id=t.season_id LEFT JOIN public.pickle_bet_settlements r ON r.id=t.settlement_id WHERE t.league_id=p_league_id AND t.pool_player_id=p),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.pickle_leaderboard(p_league_id uuid)
RETURNS TABLE(id uuid,name text,status text,balance text,rank bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id,p.name,m.status,coalesce(w.balance,0)::text,rank() OVER(ORDER BY coalesce(w.balance,0) DESC)
  FROM public.league_players m JOIN public.player_pool p ON p.id=m.pool_player_id LEFT JOIN public.pickle_wallets w ON w.league_id=m.league_id AND w.pool_player_id=m.pool_player_id
  WHERE m.league_id=p_league_id ORDER BY coalesce(w.balance,0) DESC,p.name,p.id
$$;
COMMENT ON FUNCTION public.pickle_leaderboard(uuid) IS 'Public league balances, including net settled bets; private wallets are never exposed directly.';

-- All exposed tables are read-only to API callers; financial writes use RPCs.
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['player_accounts','pickle_wallets','pickle_bets','pickle_bet_settlements','pickle_transactions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  END LOOP;
END $$;
CREATE POLICY account_owner ON public.player_accounts FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) OR (SELECT auth.jwt()->'app_metadata'->>'role')='admin');
CREATE POLICY wallet_owner ON public.pickle_wallets FOR SELECT TO authenticated USING(pool_player_id=(SELECT pickle_private.player_id()) OR (SELECT auth.jwt()->'app_metadata'->>'role')='admin');
CREATE POLICY transaction_owner ON public.pickle_transactions FOR SELECT TO authenticated USING(pool_player_id=(SELECT pickle_private.player_id()) OR (SELECT auth.jwt()->'app_metadata'->>'role')='admin');
CREATE POLICY bet_members ON public.pickle_bets FOR SELECT TO authenticated USING(pickle_private.member(league_id) OR (SELECT auth.jwt()->'app_metadata'->>'role')='admin');
CREATE POLICY settlement_members ON public.pickle_bet_settlements FOR SELECT TO authenticated USING(pickle_private.member(league_id) OR (SELECT auth.jwt()->'app_metadata'->>'role')='admin');
-- These two predicates are callable for RLS only; they return no private rows.
GRANT USAGE ON SCHEMA pickle_private TO authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pickle_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pickle_private.player_id(),pickle_private.member(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.link_player_account(uuid,text),public.my_player_account(),public.league_player_accounts(uuid),public.pickle_wallet(uuid),
  public.create_pickle_bet(uuid,uuid,numeric,numeric,uuid),public.accept_pickle_bet(uuid,uuid),public.cancel_pickle_bet(uuid),
  public.pickle_settlement_preview(uuid),public.confirm_pickle_settlement(uuid,text,integer),
  public.correct_pickle_match_result(uuid,uuid,text,uuid,integer,integer,uuid[],uuid[],timestamptz,jsonb,jsonb,bigint,text,text,integer,uuid),
  public.pickle_bets_list(uuid),public.pickle_wallet_history(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_player_account(uuid,text),public.my_player_account(),public.league_player_accounts(uuid),public.pickle_wallet(uuid),
  public.create_pickle_bet(uuid,uuid,numeric,numeric,uuid),public.accept_pickle_bet(uuid,uuid),public.cancel_pickle_bet(uuid),
  public.pickle_settlement_preview(uuid),public.confirm_pickle_settlement(uuid,text,integer),
  public.correct_pickle_match_result(uuid,uuid,text,uuid,integer,integer,uuid[],uuid[],timestamptz,jsonb,jsonb,bigint,text,text,integer,uuid),
  public.pickle_bets_list(uuid),public.pickle_wallet_history(uuid) TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pickle_bets,public.pickle_wallets,public.pickle_transactions,public.pickle_bet_settlements;
