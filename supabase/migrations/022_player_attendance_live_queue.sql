-- Attendance drives match readiness. A match is ready only when all four
-- rostered players are present; manual per-match waiting is no longer used.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS is_present boolean NOT NULL DEFAULT true;

UPDATE public.matches
SET live_status = 'available'
WHERE live_status = 'waiting';

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_live_status_valid;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_live_status_valid
  CHECK (live_status IN ('available', 'playing', 'up_next'));

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

CREATE OR REPLACE FUNCTION public.set_player_presence(
  p_player_id uuid,
  p_is_present boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_team_id uuid;
  target_season_id uuid;
  target_season_status text;
BEGIN
  SELECT player.team_id, player.season_id, season.status
  INTO target_team_id, target_season_id, target_season_status
  FROM public.players AS player
  JOIN public.seasons AS season ON season.id = player.season_id
  WHERE player.id = p_player_id;

  IF target_team_id IS NULL THEN
    RAISE EXCEPTION 'Player % was not found', p_player_id;
  END IF;
  IF target_season_status <> 'active' THEN
    RAISE EXCEPTION 'Attendance can only be changed for the active season';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sdsap_live_queue:' || target_season_id::text, 0)
  );

  IF NOT p_is_present AND EXISTS (
    SELECT 1
    FROM public.matches
    WHERE season_id = target_season_id
      AND status = 'scheduled'
      AND live_status = 'playing'
      AND target_team_id IN (home_team_id, away_team_id)
  ) THEN
    RAISE EXCEPTION 'This player is currently in the match on court';
  END IF;

  UPDATE public.players
  SET is_present = p_is_present
  WHERE id = p_player_id;

  IF NOT p_is_present THEN
    UPDATE public.matches
    SET live_status = 'available'
    WHERE season_id = target_season_id
      AND status = 'scheduled'
      AND live_status = 'up_next'
      AND target_team_id IN (home_team_id, away_team_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_player_presence(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_player_presence(uuid, boolean) TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
  END IF;
END
$$;
