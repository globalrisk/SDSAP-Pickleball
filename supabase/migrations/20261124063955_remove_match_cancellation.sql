-- Keep historical cancellations valid, while retiring the action that creates them.
CREATE OR REPLACE FUNCTION public.guard_match_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled') THEN
    RAISE EXCEPTION 'MATCH_CANCELLATION_REMOVED: Matches can no longer be cancelled' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'cancelled' AND
    (NEW.status, NEW.winner_team_id, NEW.home_score, NEW.away_score, NEW.result_recorded_at)
      IS DISTINCT FROM (OLD.status, OLD.winner_team_id, OLD.home_score, OLD.away_score, OLD.result_recorded_at) THEN
    RAISE EXCEPTION 'MATCH_CANCELLED: A cancelled match cannot receive a result';
  END IF;

  RETURN NEW;
END $$;

DROP FUNCTION public.cancel_unplayed_match(uuid);
DROP FUNCTION pickle_private.cancel_unplayed_match(uuid);
NOTIFY pgrst, 'reload schema';
