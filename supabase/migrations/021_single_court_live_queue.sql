-- Flexible one-court tournament queue. Round numbers remain schedule labels;
-- any scheduled match can be played in any order.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS live_status text NOT NULL DEFAULT 'available';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_live_status_valid'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_live_status_valid
      CHECK (live_status IN ('available', 'playing', 'up_next', 'waiting'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_finished_not_in_live_queue'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_finished_not_in_live_queue
      CHECK (status = 'scheduled' OR live_status = 'available');
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS matches_one_playing_per_season
  ON public.matches (season_id)
  WHERE status = 'scheduled' AND live_status = 'playing';

CREATE UNIQUE INDEX IF NOT EXISTS matches_one_up_next_per_season
  ON public.matches (season_id)
  WHERE status = 'scheduled' AND live_status = 'up_next';

CREATE INDEX IF NOT EXISTS idx_matches_season_live_queue
  ON public.matches (season_id, live_status, round_number)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION public.normalize_finished_match_live_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'scheduled' THEN
    NEW.live_status := 'available';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_normalize_finished_live_status ON public.matches;
CREATE TRIGGER matches_normalize_finished_live_status
BEFORE INSERT OR UPDATE OF status ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.normalize_finished_match_live_status();

CREATE OR REPLACE FUNCTION public.promote_live_queue_after_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'scheduled'
    AND OLD.live_status = 'playing'
    AND NEW.status <> 'scheduled' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('sdsap_live_queue:' || OLD.season_id::text, 0)
    );

    UPDATE public.matches
    SET live_status = 'playing'
    WHERE id = (
      SELECT id
      FROM public.matches
      WHERE season_id = OLD.season_id
        AND status = 'scheduled'
        AND live_status = 'up_next'
      ORDER BY round_number, id
      LIMIT 1
      FOR UPDATE
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS matches_promote_live_queue_after_result ON public.matches;
CREATE TRIGGER matches_promote_live_queue_after_result
AFTER UPDATE OF status ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.promote_live_queue_after_match();

CREATE OR REPLACE FUNCTION public.set_match_live_status(
  p_match_id uuid,
  p_live_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_season_id uuid;
  target_match_status text;
  target_season_status text;
BEGIN
  IF p_live_status NOT IN ('available', 'playing', 'up_next', 'waiting') THEN
    RAISE EXCEPTION 'Invalid live status: %', p_live_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT season_id INTO target_season_id
  FROM public.matches
  WHERE id = p_match_id;

  IF target_season_id IS NULL THEN
    RAISE EXCEPTION 'Match % was not found', p_match_id;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sdsap_live_queue:' || target_season_id::text, 0)
  );

  SELECT match.status, season.status
  INTO target_match_status, target_season_status
  FROM public.matches AS match
  JOIN public.seasons AS season ON season.id = match.season_id
  WHERE match.id = p_match_id
  FOR UPDATE OF match, season;

  IF target_match_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only unplayed matches can be placed in the live queue';
  END IF;
  IF target_season_status <> 'active' THEN
    RAISE EXCEPTION 'Only the active season can use the live queue';
  END IF;

  IF p_live_status = 'playing' THEN
    UPDATE public.matches
    SET live_status = 'available'
    WHERE season_id = target_season_id
      AND status = 'scheduled'
      AND live_status = 'playing'
      AND id <> p_match_id;
  ELSIF p_live_status = 'up_next' THEN
    UPDATE public.matches
    SET live_status = 'available'
    WHERE season_id = target_season_id
      AND status = 'scheduled'
      AND live_status = 'up_next'
      AND id <> p_match_id;
  END IF;

  UPDATE public.matches
  SET live_status = p_live_status
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_match_live_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_match_live_status(uuid, text) TO anon, authenticated;
