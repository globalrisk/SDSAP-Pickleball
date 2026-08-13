-- No team can be assigned to two live court slots at the same time. This also
-- protects direct table writes, not only calls through the queue RPCs.

CREATE OR REPLACE FUNCTION public.prevent_live_team_double_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'scheduled'
    AND NEW.live_status IN ('playing', 'up_next') THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('sdsap_live_queue:' || NEW.season_id::text, 0)
    );

    IF EXISTS (
      SELECT 1
      FROM public.matches AS other
      WHERE other.season_id = NEW.season_id
        AND other.id <> NEW.id
        AND other.status = 'scheduled'
        AND other.live_status = 'playing'
        AND (
          NEW.home_team_id IN (other.home_team_id, other.away_team_id)
          OR NEW.away_team_id IN (other.home_team_id, other.away_team_id)
        )
    ) THEN
      RAISE EXCEPTION 'A team in this match is already playing on another court'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_prevent_live_team_double_booking ON public.matches;
CREATE TRIGGER matches_prevent_live_team_double_booking
BEFORE INSERT OR UPDATE OF status, live_status, live_court_number
ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.prevent_live_team_double_booking();
