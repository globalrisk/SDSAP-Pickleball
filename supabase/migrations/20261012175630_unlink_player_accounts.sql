-- Account ownership can be revoked by administrators without moving player
-- balances or history. Keep an immutable receipt, including safe retry keys.
CREATE TABLE pickle_private.account_unlink_receipts (
  request_id uuid PRIMARY KEY,
  pool_player_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE RESTRICT,
  email text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  linked_at timestamptz,
  removed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  removed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_unlink_player_idx ON pickle_private.account_unlink_receipts(pool_player_id);
CREATE INDEX account_unlink_user_idx ON pickle_private.account_unlink_receipts(user_id);
CREATE INDEX account_unlink_linked_by_idx ON pickle_private.account_unlink_receipts(linked_by);
CREATE INDEX account_unlink_removed_by_idx ON pickle_private.account_unlink_receipts(removed_by);
ALTER TABLE pickle_private.account_unlink_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pickle_private.account_unlink_receipts FROM PUBLIC, anon, authenticated;
CREATE TRIGGER immutable_account_unlinks BEFORE UPDATE OR DELETE ON pickle_private.account_unlink_receipts
FOR EACH ROW EXECUTE FUNCTION pickle_private.immutable();

CREATE TABLE pickle_private.account_unlink_context (
  transaction_id bigint PRIMARY KEY, user_id uuid NOT NULL, pool_player_id uuid NOT NULL
);
ALTER TABLE pickle_private.account_unlink_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pickle_private.account_unlink_context FROM PUBLIC, anon, authenticated;

CREATE FUNCTION pickle_private.lock_player_account() RETURNS uuid
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'BET_LINK: A signed-in account is required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_player_account:' || auth.uid()::text, 0));
  RETURN pickle_private.player_id();
END $$;
REVOKE ALL ON FUNCTION pickle_private.lock_player_account() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION pickle_private.guard_player_account_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
  IF TG_OP = 'DELETE' AND pickle_private.is_admin() AND EXISTS (
    SELECT 1 FROM pickle_private.account_unlink_context c
    WHERE c.transaction_id=txid_current() AND c.user_id=OLD.user_id AND c.pool_player_id=OLD.pool_player_id
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'BET_IMMUTABLE: Use the protected administrator unlink operation' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION pickle_private.guard_player_account_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER immutable_player_accounts ON public.player_accounts;
CREATE TRIGGER immutable_player_accounts BEFORE UPDATE OR DELETE ON public.player_accounts
FOR EACH ROW EXECUTE FUNCTION pickle_private.guard_player_account_link();

CREATE FUNCTION public.unlink_player_account(p_player_id uuid, p_email text, p_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE original public.player_accounts; previous pickle_private.account_unlink_receipts;
  requested_email text := lower(trim(p_email));
BEGIN
  PERFORM pickle_private.require_admin();
  IF p_request_id IS NULL OR requested_email IS NULL OR requested_email='' THEN
    RAISE EXCEPTION 'BET_REQUEST: An email and request identifier are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_player_account_links',0));
  SELECT * INTO previous FROM pickle_private.account_unlink_receipts WHERE request_id=p_request_id;
  IF FOUND THEN
    IF previous.pool_player_id IS DISTINCT FROM p_player_id OR previous.email<>requested_email THEN
      RAISE EXCEPTION 'BET_REQUEST: Request identifier reused with different account';
    END IF;
    RETURN;
  END IF;
  SELECT a.* INTO original FROM public.player_accounts a JOIN auth.users u ON u.id=a.user_id
  WHERE a.pool_player_id=p_player_id AND lower(u.email)=requested_email;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.player_accounts WHERE pool_player_id=p_player_id) THEN
      RAISE EXCEPTION 'BET_LINK_CHANGED: This player is linked to a different account';
    END IF;
    INSERT INTO pickle_private.account_unlink_receipts(request_id,pool_player_id,email,removed_by)
    VALUES(p_request_id,p_player_id,requested_email,auth.uid());
    RETURN;
  END IF;
  -- The same per-account lock is acquired before deriving identity in every
  -- bet mutation. Unlinking cannot race a new offer or acceptance.
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_player_account:' || original.user_id::text,0));
  PERFORM 1 FROM public.player_accounts WHERE user_id=original.user_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.pickle_bets WHERE (creator_id=p_player_id OR acceptor_id=p_player_id)
    AND state IN ('open','accepted','review')) THEN
    RAISE EXCEPTION 'BET_UNLINK_PENDING: Cancel open offers and settle accepted bets before unlinking';
  END IF;
  INSERT INTO pickle_private.account_unlink_receipts(request_id,pool_player_id,email,user_id,linked_by,linked_at,removed_by)
  VALUES(p_request_id,p_player_id,requested_email,original.user_id,original.linked_by,original.linked_at,auth.uid());
  INSERT INTO pickle_private.account_unlink_context VALUES(txid_current(),original.user_id,p_player_id);
  DELETE FROM public.player_accounts WHERE user_id=original.user_id AND pool_player_id=p_player_id;
  DELETE FROM pickle_private.account_unlink_context WHERE transaction_id=txid_current();
END $$;
REVOKE ALL ON FUNCTION public.unlink_player_account(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_player_account(uuid,text,uuid) TO authenticated;

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
  PERFORM pickle_private.lock_wallets(b.league_id,ARRAY[b.creator_id,p]);
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=b.league_id AND pool_player_id=p)-pickle_private.reserved(b.league_id,p)<b.acceptor_stake THEN RAISE EXCEPTION 'BET_FUNDS: Insufficient available points'; END IF;
  IF (SELECT balance FROM public.pickle_wallets WHERE league_id=b.league_id AND pool_player_id=b.creator_id)<pickle_private.reserved(b.league_id,b.creator_id) THEN RAISE EXCEPTION 'BET_FUNDS: Creator no longer has enough points'; END IF;
  UPDATE public.pickle_bets SET acceptor_id=p,acceptor_request=p_request_id,state='accepted',accepted_at=now(),updated_at=now() WHERE id=b.id;
  RETURN b.id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_pickle_bet(p_bet_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE b public.pickle_bets; p uuid; BEGIN
  p:=pickle_private.lock_player_account();
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id;
  IF NOT FOUND OR b.creator_id IS DISTINCT FROM p THEN RAISE EXCEPTION 'BET_OWNER: Only the creator can cancel' USING ERRCODE='42501'; END IF;
  PERFORM pickle_private.lock_match(b.match_id);
  SELECT * INTO b FROM public.pickle_bets WHERE id=p_bet_id FOR UPDATE;
  IF b.state='cancelled' THEN RETURN; END IF;
  IF b.state<>'open' THEN RAISE EXCEPTION 'BET_ACCEPTED: Accepted bets cannot be cancelled'; END IF;
  PERFORM pickle_private.lock_wallets(b.league_id,ARRAY[b.creator_id]);
  UPDATE public.pickle_bets SET state='cancelled',close_reason='creator',updated_at=now() WHERE id=b.id;
END $$;
