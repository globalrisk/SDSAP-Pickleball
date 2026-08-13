-- Support multiple concurrently active courts while keeping one shared,
-- automatically recommended Up Next match.

ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS live_court_count integer NOT NULL DEFAULT 1;

ALTER TABLE public.seasons
  DROP CONSTRAINT IF EXISTS seasons_live_court_count_valid;

ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_live_court_count_valid
  CHECK (live_court_count BETWEEN 1 AND 4);

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS live_court_number integer;

DROP INDEX IF EXISTS public.matches_one_playing_per_season;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_live_court_assignment_valid;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_live_court_assignment_valid
  CHECK (
    (
      status = 'scheduled'
      AND live_status = 'playing'
      AND live_court_number BETWEEN 1 AND 4
    )
    OR (
      NOT (status = 'scheduled' AND live_status = 'playing')
      AND live_court_number IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS matches_one_match_per_live_court
  ON public.matches (season_id, live_court_number)
  WHERE status = 'scheduled' AND live_status = 'playing';

CREATE OR REPLACE FUNCTION public.normalize_finished_match_live_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'scheduled' THEN
    NEW.live_status := 'available';
    NEW.live_court_number := NULL;
  ELSIF NEW.live_status <> 'playing' THEN
    NEW.live_court_number := NULL;
  END IF;
  RETURN NEW;
END;
$$;

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
    SET live_status = 'playing',
        live_court_number = OLD.live_court_number
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
  configured_courts integer;
  assigned_court integer;
  all_players_present boolean;
BEGIN
  IF p_live_status NOT IN ('available', 'playing', 'up_next') THEN
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

  SELECT match.status, season.status, season.live_court_count
  INTO target_match_status, target_season_status, configured_courts
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

  SELECT bool_and(player.is_present) AND count(*) = 4
  INTO all_players_present
  FROM public.matches AS match
  JOIN public.players AS player
    ON player.team_id IN (match.home_team_id, match.away_team_id)
  WHERE match.id = p_match_id;

  IF p_live_status IN ('playing', 'up_next') AND NOT COALESCE(all_players_present, false) THEN
    RAISE EXCEPTION 'All four players must be present before queuing this match';
  END IF;

  IF p_live_status = 'playing' THEN
    SELECT court_number INTO assigned_court
    FROM generate_series(1, configured_courts) AS court_number
    WHERE NOT EXISTS (
      SELECT 1 FROM public.matches
      WHERE season_id = target_season_id
        AND status = 'scheduled'
        AND live_status = 'playing'
        AND live_court_number = court_number
        AND id <> p_match_id
    )
    ORDER BY court_number
    LIMIT 1;

    IF assigned_court IS NULL THEN
      RAISE EXCEPTION 'All configured courts are currently occupied';
    END IF;
  ELSIF p_live_status = 'up_next' THEN
    UPDATE public.matches
    SET live_status = 'available',
        live_court_number = NULL
    WHERE season_id = target_season_id
      AND status = 'scheduled'
      AND live_status = 'up_next'
      AND id <> p_match_id;
  END IF;

  UPDATE public.matches
  SET live_status = p_live_status,
      live_court_number = CASE WHEN p_live_status = 'playing' THEN assigned_court ELSE NULL END
  WHERE id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_live_court_count(
  p_season_id uuid,
  p_court_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_season_status text;
BEGIN
  IF p_court_count NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Court count must be between 1 and 4'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sdsap_live_queue:' || p_season_id::text, 0)
  );

  SELECT status INTO target_season_status
  FROM public.seasons
  WHERE id = p_season_id
  FOR UPDATE;

  IF target_season_status IS NULL THEN
    RAISE EXCEPTION 'Season % was not found', p_season_id;
  END IF;
  IF target_season_status <> 'active' THEN
    RAISE EXCEPTION 'Court count can only be changed for the active season';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE season_id = p_season_id
      AND status = 'scheduled'
      AND live_status = 'playing'
      AND live_court_number > p_court_count
  ) THEN
    RAISE EXCEPTION 'Finish matches on higher-numbered courts before reducing the court count';
  END IF;

  UPDATE public.seasons
  SET live_court_count = p_court_count
  WHERE id = p_season_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_live_court_count(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_live_court_count(uuid, integer) TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seasons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seasons;
  END IF;
END
$$;
