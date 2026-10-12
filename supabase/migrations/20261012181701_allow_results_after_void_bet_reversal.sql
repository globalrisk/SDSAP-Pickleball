-- A fully voided bet with zero net ledger effect does not prevent the real match result from being recorded.
CREATE OR REPLACE FUNCTION pickle_private.guard_match() RETURNS trigger
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
  IF EXISTS(SELECT 1 FROM public.pickle_bet_settlements WHERE match_id=OLD.id) AND (
    EXISTS(SELECT 1 FROM public.pickle_bets WHERE match_id=OLD.id AND state IN('accepted','review','settled','refunded'))
    OR EXISTS(SELECT 1 FROM public.pickle_transactions t JOIN public.pickle_bets b ON b.id=t.bet_id
      WHERE b.match_id=OLD.id GROUP BY t.bet_id,t.pool_player_id HAVING sum(t.amount)<>0)
  ) AND
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
