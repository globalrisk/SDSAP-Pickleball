-- Delete one team without leaving fixtures that reference it.

CREATE OR REPLACE FUNCTION public.delete_season_team_atomic(
  p_season_id uuid,
  p_team_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  season_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('sdsap_season_setup:' || p_season_id::text, 0)
  );

  SELECT status INTO season_status
  FROM public.seasons
  WHERE id = p_season_id
  FOR UPDATE;

  IF season_status IS NULL THEN
    RAISE EXCEPTION 'Season % was not found', p_season_id;
  END IF;
  IF season_status <> 'active' THEN
    RAISE EXCEPTION 'Only the active season can have a team deleted';
  END IF;

  PERFORM 1
  FROM public.teams
  WHERE id = p_team_id
    AND season_id = p_season_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team % was not found in this season', p_team_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE season_id = p_season_id
      AND (home_team_id = p_team_id OR away_team_id = p_team_id)
      AND status IN ('completed', 'forfeit')
  ) THEN
    RAISE EXCEPTION 'Cannot delete a team after its results have been recorded';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE season_id = p_season_id
      AND (home_team_id = p_team_id OR away_team_id = p_team_id)
      AND status = 'scheduled'
      AND live_status = 'playing'
  ) THEN
    RAISE EXCEPTION 'Cannot delete a team while it has a match in progress';
  END IF;

  DELETE FROM public.matches
  WHERE season_id = p_season_id
    AND (home_team_id = p_team_id OR away_team_id = p_team_id)
    AND status = 'scheduled';

  DELETE FROM public.teams
  WHERE id = p_team_id
    AND season_id = p_season_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_season_team_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_season_team_atomic(uuid, uuid)
  TO anon, authenticated;
