-- One-time, owner-authorized cleanup of the reversed SDSAP Season 14 test.
-- No generated record IDs are embedded. Ordinary audit and closure protections
-- remain enabled after this atomic migration, and API permissions do not change.
DO $$
DECLARE league uuid; season uuid; m public.matches; b public.pickle_bets;
  wallets_before jsonb; wallets_after jsonb; receipt_ids uuid[]; deleted_count integer;
BEGIN
  SELECT id INTO league FROM public.leagues WHERE slug='sdsap';
  IF league IS NULL THEN RETURN; END IF;
  SELECT id INTO season FROM public.seasons WHERE league_id=league AND name='Season 14';
  IF season IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.seasons WHERE league_id=league AND name='Season 14')<>1 THEN
    RAISE EXCEPTION 'Ambiguous Season 14';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:'||league::text,0));
  -- Take relation locks before wallet snapshots or row mutations. Trigger
  -- exceptions are never visible to concurrent API writes.
  LOCK TABLE public.matches, public.pickle_bets, public.pickle_bet_settlements,
    public.pickle_transactions IN ACCESS EXCLUSIVE MODE;
  PERFORM 1 FROM public.seasons WHERE id=season FOR UPDATE;
  SELECT * INTO m FROM public.matches WHERE season_id=season AND duel_sequence_number=2;
  IF NOT FOUND THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.matches WHERE season_id=season AND duel_sequence_number=2)<>1 THEN
    RAISE EXCEPTION 'Ambiguous test match';
  END IF;
  -- Safe on fresh installations and retries; never purge a later real bet.
  SELECT * INTO b FROM public.pickle_bets WHERE match_id=m.id AND close_reason='test_rollback';
  IF NOT FOUND THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.pickle_bets WHERE match_id=m.id)<>1 OR b.state<>'void'
    OR b.creator_stake<>1000 OR b.acceptor_stake<>1000 THEN RAISE EXCEPTION 'Test contract changed'; END IF;
  IF (SELECT status FROM public.seasons WHERE id=season)<>'active'
    OR (SELECT format FROM public.seasons WHERE id=season)<>'team_duel'
    OR m.status<>'scheduled' OR m.live_status<>'available' OR m.live_court_number IS NOT NULL
    OR m.home_score IS NOT NULL OR m.away_score IS NOT NULL OR m.winner_team_id IS NOT NULL
    OR m.result_recorded_at IS NOT NULL OR m.betting_closed_at IS NULL THEN
    RAISE EXCEPTION 'Test match is not in the reviewed reset state';
  END IF;
  SELECT array_agg(id ORDER BY revision) INTO receipt_ids FROM public.pickle_bet_settlements WHERE match_id=m.id;
  IF cardinality(receipt_ids)<>2 OR NOT EXISTS(SELECT 1 FROM public.pickle_bet_settlements
    WHERE match_id=m.id AND revision=2 AND reason='Season 14 test rollback requested through Codex; original settlement administrator retained as audit reference') THEN
    RAISE EXCEPTION 'Test settlement history changed';
  END IF;
  IF (SELECT count(*) FROM public.pickle_transactions WHERE bet_id=b.id)<>4
    OR (SELECT count(*) FROM public.pickle_transactions WHERE bet_id=b.id AND kind='bet')<>2
    OR (SELECT count(*) FROM public.pickle_transactions WHERE bet_id=b.id AND kind='reversal')<>2
    OR EXISTS(SELECT 1 FROM public.pickle_transactions WHERE bet_id=b.id GROUP BY pool_player_id HAVING sum(amount)<>0)
    OR EXISTS(SELECT 1 FROM public.pickle_transactions WHERE settlement_id=ANY(receipt_ids) AND bet_id IS DISTINCT FROM b.id)
    OR EXISTS(SELECT 1 FROM public.pickle_transactions WHERE bet_id IS DISTINCT FROM b.id AND reverses_id IN
      (SELECT id FROM public.pickle_transactions WHERE bet_id=b.id)) THEN
    RAISE EXCEPTION 'Test ledger is not completely reversed and isolated';
  END IF;
  SELECT jsonb_agg(to_jsonb(w) ORDER BY w.league_id,w.pool_player_id) INTO wallets_before FROM public.pickle_wallets w;
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.pickle_transactions DISABLE TRIGGER immutable_pickle_transactions;
  ALTER TABLE public.pickle_bet_settlements DISABLE TRIGGER immutable_pickle_settlements;
  ALTER TABLE public.matches DISABLE TRIGGER ab_guard_pickle_bets;
  DELETE FROM public.pickle_transactions WHERE bet_id=b.id AND kind='reversal';
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  IF deleted_count<>2 THEN RAISE EXCEPTION 'Unexpected test reversal count'; END IF;
  DELETE FROM public.pickle_transactions WHERE bet_id=b.id AND kind='bet';
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  IF deleted_count<>2 THEN RAISE EXCEPTION 'Unexpected test transaction count'; END IF;
  DELETE FROM public.pickle_bet_settlements WHERE id=ANY(receipt_ids);
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  IF deleted_count<>2 THEN RAISE EXCEPTION 'Unexpected test receipt count'; END IF;
  DELETE FROM pickle_private.correction_requests WHERE match_id=m.id;
  DELETE FROM public.pickle_bets WHERE id=b.id;
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  IF deleted_count<>1 THEN RAISE EXCEPTION 'Unexpected test bet count'; END IF;
  UPDATE public.matches SET betting_closed_at=NULL WHERE id=m.id;
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.matches ENABLE TRIGGER ab_guard_pickle_bets;
  ALTER TABLE public.pickle_bet_settlements ENABLE TRIGGER immutable_pickle_settlements;
  ALTER TABLE public.pickle_transactions ENABLE TRIGGER immutable_pickle_transactions;
  SELECT jsonb_agg(to_jsonb(w) ORDER BY w.league_id,w.pool_player_id) INTO wallets_after FROM public.pickle_wallets w;
  IF wallets_before IS DISTINCT FROM wallets_after THEN RAISE EXCEPTION 'Cleanup changed player balances'; END IF;
  IF EXISTS(SELECT 1 FROM public.pickle_wallets w WHERE w.league_id=league AND w.pool_player_id IN(b.creator_id,b.acceptor_id)
    AND w.balance<>(SELECT coalesce(sum(t.amount),0) FROM public.pickle_transactions t
      WHERE t.league_id=w.league_id AND t.pool_player_id=w.pool_player_id)) THEN
    RAISE EXCEPTION 'Wallet and remaining ledger disagree';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN('ab_guard_pickle_bets','immutable_pickle_settlements','immutable_pickle_transactions') AND tgenabled<>'O') THEN
    RAISE EXCEPTION 'Cleanup did not restore database guards';
  END IF;
END $$;
