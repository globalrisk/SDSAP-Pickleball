-- Atomically claim an empty Up Next slot. The client supplies its deterministic
-- recommendation; the database prevents competing devices from overwriting it.

CREATE OR REPLACE FUNCTION public.seed_match_up_next(p_match_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_season_id uuid;
  target_match_status text;
  target_live_status text;
  target_season_status text;
  all_players_present boolean;
BEGIN
  SELECT season_id INTO target_season_id
  FROM public.matches
  WHERE id = p_match_id;

  IF target_season_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sdsap_live_queue:' || target_season_id::text, 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE season_id = target_season_id
      AND status = 'scheduled'
      AND live_status = 'up_next'
  ) THEN
    RETURN false;
  END IF;

  SELECT match.status, match.live_status, season.status
  INTO target_match_status, target_live_status, target_season_status
  FROM public.matches AS match
  JOIN public.seasons AS season ON season.id = match.season_id
  WHERE match.id = p_match_id
  FOR UPDATE OF match, season;

  IF target_match_status <> 'scheduled'
    OR target_live_status <> 'available'
    OR target_season_status <> 'active' THEN
    RETURN false;
  END IF;

  SELECT bool_and(player.is_present) AND count(*) = 4
  INTO all_players_present
  FROM public.matches AS match
  JOIN public.players AS player
    ON player.team_id IN (match.home_team_id, match.away_team_id)
  WHERE match.id = p_match_id;

  IF NOT COALESCE(all_players_present, false) THEN
    RETURN false;
  END IF;

  UPDATE public.matches
  SET live_status = 'up_next'
  WHERE id = p_match_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_match_up_next(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_match_up_next(uuid) TO anon, authenticated;
