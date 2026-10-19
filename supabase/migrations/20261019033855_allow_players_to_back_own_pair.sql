-- Allow players to back their own pair while preserving account, match and wallet locks.

CREATE OR REPLACE FUNCTION pickle_private.eligible(p_league uuid,p_match public.matches,p_player uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF p_player IS NULL OR NOT EXISTS(SELECT 1 FROM public.league_players WHERE league_id=p_league AND pool_player_id=p_player AND status='active') THEN RAISE EXCEPTION 'BET_MEMBER: Active linked league membership required' USING ERRCODE='42501'; END IF;
  IF p_match.status<>'scheduled' OR p_match.betting_closed_at IS NOT NULL OR p_match.live_status='playing' THEN RAISE EXCEPTION 'BET_CLOSED: Betting is closed for this match'; END IF;
END $$;
-- Participants may back only their own pair. Non-playing league members
-- retain the ability to back either pair, including their squad's opponents.
CREATE FUNCTION pickle_private.require_backed_side(p_match public.matches,p_player uuid,p_side uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  IF (p_player=ANY(pickle_private.side_ids(p_match,true)) AND p_side IS DISTINCT FROM p_match.home_team_id)
    OR (p_player=ANY(pickle_private.side_ids(p_match,false)) AND p_side IS DISTINCT FROM p_match.away_team_id) THEN
    RAISE EXCEPTION 'BET_SELF_SIDE: Participants can only back their own pair';
  END IF;
END $$;
REVOKE ALL ON FUNCTION pickle_private.require_backed_side(public.matches,uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_pickle_bet(p_match_id uuid,p_side_id uuid,p_creator_stake numeric,p_acceptor_stake numeric,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE m public.matches; league uuid; p uuid; prior public.pickle_bets; result uuid; BEGIN
  p:=pickle_private.lock_player_account();
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
  PERFORM pickle_private.require_backed_side(m,p,p_side_id);
  PERFORM pickle_private.lock_wallets(league,ARRAY[p]);
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=league AND pool_player_id=p)-pickle_private.reserved(league,p)<p_creator_stake THEN RAISE EXCEPTION 'BET_FUNDS: Insufficient available points'; END IF;
  INSERT INTO public.pickle_bets(league_id,season_id,match_id,creator_id,creator_side,home_team_id,away_team_id,home_ids,away_ids,creator_stake,acceptor_stake,creator_request)
  VALUES(league,m.season_id,m.id,p,p_side_id,m.home_team_id,m.away_team_id,
    pickle_private.side_ids(m,true),pickle_private.side_ids(m,false),p_creator_stake,p_acceptor_stake,p_request_id) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.accept_pickle_bet(p_bet_id uuid,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE b public.pickle_bets; m public.matches; p uuid; BEGIN
  p:=pickle_private.lock_player_account();
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id;
  IF NOT FOUND OR p IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'BET_LINK: Bet and linked account required' USING ERRCODE='42501'; END IF;
  m:=pickle_private.lock_match(b.match_id);
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id FOR UPDATE;
  IF b.acceptor_id=p AND b.acceptor_request=p_request_id THEN RETURN b.id; END IF;
  PERFORM pickle_private.eligible(b.league_id,m,p);
  IF b.state<>'open' OR b.creator_id=p THEN RAISE EXCEPTION 'BET_TAKEN: This offer is no longer available'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_players WHERE league_id=b.league_id AND pool_player_id=b.creator_id AND status='active') THEN RAISE EXCEPTION 'BET_MEMBER: Creator is no longer an active league member'; END IF;
  PERFORM pickle_private.require_backed_side(m,p,CASE WHEN b.creator_side=m.home_team_id THEN m.away_team_id ELSE m.home_team_id END);
  PERFORM pickle_private.lock_wallets(b.league_id,ARRAY[b.creator_id,p]);
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=b.league_id AND pool_player_id=p)-pickle_private.reserved(b.league_id,p)<b.acceptor_stake THEN RAISE EXCEPTION 'BET_FUNDS: Insufficient available points'; END IF;
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=b.league_id AND pool_player_id=b.creator_id)<pickle_private.reserved(b.league_id,b.creator_id) THEN RAISE EXCEPTION 'BET_FUNDS: Creator no longer has enough points'; END IF;
  UPDATE public.pickle_bets SET acceptor_id=p,acceptor_request=p_request_id,state='accepted',accepted_at=now(),updated_at=now() WHERE id=b.id;
  RETURN b.id;
END $$;

