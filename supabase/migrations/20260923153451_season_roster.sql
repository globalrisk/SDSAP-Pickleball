-- A league membership is persistent; participation is chosen for each season.
-- Existing team assignments are enrolled so older seasons keep their roster.
ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_id_league_id_key UNIQUE (id, league_id);

CREATE TABLE public.season_roster (
  season_id uuid NOT NULL,
  league_id uuid NOT NULL,
  pool_player_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, pool_player_id),
  CONSTRAINT season_roster_season_fkey
    FOREIGN KEY (season_id, league_id)
    REFERENCES public.seasons (id, league_id) ON DELETE CASCADE,
  CONSTRAINT season_roster_membership_fkey
    FOREIGN KEY (league_id, pool_player_id)
    REFERENCES public.league_players (league_id, pool_player_id) ON DELETE CASCADE
);

CREATE INDEX season_roster_membership_idx
  ON public.season_roster (league_id, pool_player_id);

INSERT INTO public.season_roster (season_id, league_id, pool_player_id)
SELECT DISTINCT player.season_id, season.league_id, player.pool_player_id
FROM public.players AS player
JOIN public.seasons AS season ON season.id = player.season_id;

ALTER TABLE public.season_roster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read season roster" ON public.season_roster
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admin insert season roster" ON public.season_roster
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
CREATE POLICY "Admin delete season roster" ON public.season_roster
  FOR DELETE TO authenticated
  USING ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

REVOKE ALL ON public.season_roster FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.season_roster TO anon, authenticated;
GRANT INSERT, DELETE ON public.season_roster TO authenticated;

-- The existing league-creation and team-management functions insert directly
-- into players. Keep their assigned players in the season roster automatically.
CREATE FUNCTION public.enroll_assigned_season_player()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_league_id uuid;
BEGIN
  SELECT league_id INTO v_league_id
  FROM public.seasons
  WHERE id = NEW.season_id;

  INSERT INTO public.season_roster (season_id, league_id, pool_player_id)
  VALUES (NEW.season_id, v_league_id, NEW.pool_player_id)
  ON CONFLICT (season_id, pool_player_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER players_enroll_in_season_roster
AFTER INSERT OR UPDATE OF season_id, pool_player_id ON public.players
FOR EACH ROW EXECUTE FUNCTION public.enroll_assigned_season_player();

ALTER TABLE public.players
  ADD CONSTRAINT players_season_roster_fkey
  FOREIGN KEY (season_id, pool_player_id)
  REFERENCES public.season_roster (season_id, pool_player_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION public.save_season_roster_atomic(
  p_season_id uuid,
  p_pool_player_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_league_id uuid;
  v_status text;
  v_count integer;
BEGIN
  IF (select auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('league_season_setup:' || p_season_id::text, 0)
  );

  SELECT league_id, status INTO v_league_id, v_status
  FROM public.seasons
  WHERE id = p_season_id;
  IF NOT FOUND OR v_status <> 'active' THEN
    RAISE EXCEPTION 'Only an active season roster can be changed';
  END IF;

  IF p_pool_player_ids IS NULL OR array_position(p_pool_player_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A season roster must be an array of player IDs';
  END IF;

  v_count := coalesce(array_length(p_pool_player_ids, 1), 0);
  IF (SELECT count(DISTINCT player_id)
      FROM unnest(p_pool_player_ids) AS player_id) <> v_count THEN
    RAISE EXCEPTION 'A season roster cannot contain duplicate players';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_pool_player_ids) AS selected(player_id)
    LEFT JOIN public.league_players AS membership
      ON membership.league_id = v_league_id
     AND membership.pool_player_id = selected.player_id
     AND membership.status = 'active'
    WHERE membership.pool_player_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every selected player must be active in this league';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.players AS assigned
    WHERE assigned.season_id = p_season_id
      AND NOT (assigned.pool_player_id = ANY (p_pool_player_ids))
  ) THEN
    RAISE EXCEPTION 'Remove a player from their season team before excluding them';
  END IF;

  DELETE FROM public.season_roster
  WHERE season_id = p_season_id
    AND NOT (pool_player_id = ANY (p_pool_player_ids));

  INSERT INTO public.season_roster (season_id, league_id, pool_player_id)
  SELECT p_season_id, v_league_id, player_id
  FROM unnest(p_pool_player_ids) AS player_id
  ON CONFLICT (season_id, pool_player_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.save_season_roster_atomic(uuid, uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_season_roster_atomic(uuid, uuid[])
  TO authenticated;

-- Setup uses this entry point so a stale form cannot quietly add somebody
-- back to the season when a team is saved. The league wizard retains the
-- existing team RPC; the players trigger enrolls its initial assignments.
CREATE FUNCTION public.save_selected_season_teams_atomic(
  p_season_id uuid,
  p_teams jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_team jsonb;
  v_player_id uuid;
BEGIN
  IF (select auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('league_season_setup:' || p_season_id::text, 0)
  );

  FOR v_team IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    FOR v_player_id IN
      SELECT value::uuid FROM jsonb_array_elements_text(v_team->'poolPlayerIds')
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.season_roster
        WHERE season_id = p_season_id AND pool_player_id = v_player_id
      ) THEN
        RAISE EXCEPTION 'Select every team player for this season first';
      END IF;
    END LOOP;
  END LOOP;

  RETURN public.save_season_teams_atomic(p_season_id, p_teams);
END;
$$;

REVOKE ALL ON FUNCTION public.save_selected_season_teams_atomic(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_selected_season_teams_atomic(uuid, jsonb)
  TO authenticated;
