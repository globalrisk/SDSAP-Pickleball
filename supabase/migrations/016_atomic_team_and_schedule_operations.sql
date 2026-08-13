-- Keep season rosters and fixtures internally consistent, and expose the
-- multi-row setup operations as short database transactions.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS season_id uuid;

UPDATE public.players AS player
SET season_id = team.season_id
FROM public.teams AS team
WHERE team.id = player.team_id
  AND player.season_id IS NULL;

ALTER TABLE public.players
  ALTER COLUMN season_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'teams_id_season_id_key'
      AND conrelid = 'public.teams'::regclass
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_id_season_id_key UNIQUE (id, season_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'players_team_season_fkey'
      AND conrelid = 'public.players'::regclass
  ) THEN
    ALTER TABLE public.players
      ADD CONSTRAINT players_team_season_fkey
      FOREIGN KEY (team_id, season_id)
      REFERENCES public.teams (id, season_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'players_one_team_per_season'
      AND conrelid = 'public.players'::regclass
  ) THEN
    ALTER TABLE public.players
      ADD CONSTRAINT players_one_team_per_season
      UNIQUE (season_id, pool_player_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_home_team_season_fkey'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_home_team_season_fkey
      FOREIGN KEY (home_team_id, season_id)
      REFERENCES public.teams (id, season_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_away_team_season_fkey'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_away_team_season_fkey
      FOREIGN KEY (away_team_id, season_id)
      REFERENCES public.teams (id, season_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_players_team_season
  ON public.players (team_id, season_id);

CREATE INDEX IF NOT EXISTS idx_matches_home_team_season
  ON public.matches (home_team_id, season_id);

CREATE INDEX IF NOT EXISTS idx_matches_away_team_season
  ON public.matches (away_team_id, season_id);

CREATE OR REPLACE FUNCTION public.check_team_has_two_players()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  team_id_to_check uuid;
  player_count integer;
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    team_id_to_check := COALESCE(NEW.id, OLD.id);
  ELSIF TG_OP = 'DELETE' THEN
    team_id_to_check := OLD.team_id;
  ELSE
    team_id_to_check := NEW.team_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.teams WHERE id = team_id_to_check) THEN
    SELECT count(*) INTO player_count
    FROM public.players
    WHERE team_id = team_id_to_check;

    IF player_count <> 2 THEN
      RAISE EXCEPTION 'Team % must have exactly 2 players', team_id_to_check
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'players' THEN
    IF TG_OP = 'UPDATE' AND OLD.team_id IS DISTINCT FROM NEW.team_id THEN
      IF EXISTS (SELECT 1 FROM public.teams WHERE id = OLD.team_id) THEN
        SELECT count(*) INTO player_count
        FROM public.players
        WHERE team_id = OLD.team_id;

        IF player_count <> 2 THEN
          RAISE EXCEPTION 'Team % must have exactly 2 players', OLD.team_id
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;

  -- The return value of an AFTER trigger is ignored.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS teams_require_two_players ON public.teams;
CREATE CONSTRAINT TRIGGER teams_require_two_players
AFTER INSERT OR UPDATE ON public.teams
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_team_has_two_players();

DROP TRIGGER IF EXISTS player_changes_preserve_two_player_teams ON public.players;
CREATE CONSTRAINT TRIGGER player_changes_preserve_two_player_teams
AFTER INSERT OR UPDATE OR DELETE ON public.players
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_team_has_two_players();

CREATE OR REPLACE FUNCTION public.save_season_teams_atomic(
  p_season_id uuid,
  p_teams jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  season_status text;
  team_payload jsonb;
  target_team_id uuid;
  team_name text;
  team_color text;
  pool_ids uuid[];
  pool_id uuid;
  pool_name text;
  saved_team_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF jsonb_typeof(p_teams) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_teams) = 0 THEN
    RAISE EXCEPTION 'At least one team is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sdsap_season_setup:' || p_season_id::text, 0));

  SELECT status INTO season_status
  FROM public.seasons
  WHERE id = p_season_id
  FOR UPDATE;

  IF season_status IS NULL THEN
    RAISE EXCEPTION 'Season % was not found', p_season_id;
  END IF;
  IF season_status <> 'active' THEN
    RAISE EXCEPTION 'Only the active season can be changed';
  END IF;

  FOR team_payload IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    target_team_id := NULLIF(team_payload->>'id', '')::uuid;
    team_name := btrim(COALESCE(team_payload->>'name', ''));
    team_color := NULLIF(btrim(COALESCE(team_payload->>'color', '')), '');

    SELECT array_agg(value::uuid ORDER BY ordinality)
    INTO pool_ids
    FROM jsonb_array_elements_text(team_payload->'poolPlayerIds')
      WITH ORDINALITY AS selected(value, ordinality);

    IF team_name = '' THEN
      RAISE EXCEPTION 'Team name cannot be empty';
    END IF;
    IF cardinality(pool_ids) <> 2 OR pool_ids[1] = pool_ids[2] THEN
      RAISE EXCEPTION 'A team must have exactly 2 different players';
    END IF;

    IF target_team_id IS NULL THEN
      IF team_color IS NULL THEN
        RAISE EXCEPTION 'Team color cannot be empty';
      END IF;

      INSERT INTO public.teams (season_id, name, color)
      VALUES (p_season_id, team_name, team_color)
      RETURNING id INTO target_team_id;
    ELSE
      UPDATE public.teams
      SET name = team_name,
          color = COALESCE(team_color, color)
      WHERE id = target_team_id
        AND season_id = p_season_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Team % was not found in this season', target_team_id;
      END IF;

      DELETE FROM public.players WHERE team_id = target_team_id;
    END IF;

    FOREACH pool_id IN ARRAY pool_ids
    LOOP
      SELECT name INTO pool_name
      FROM public.player_pool
      WHERE id = pool_id
        AND status = 'active';

      IF pool_name IS NULL THEN
        RAISE EXCEPTION 'Player % was not found or is inactive', pool_id;
      END IF;

      INSERT INTO public.players (name, team_id, pool_player_id, season_id)
      VALUES (pool_name, target_team_id, pool_id, p_season_id);
    END LOOP;

    saved_team_ids := array_append(saved_team_ids, target_team_id);
  END LOOP;

  RETURN saved_team_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_season_matches_atomic(
  p_season_id uuid,
  p_matches jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  season_status text;
  team_count integer;
  match_count integer;
  expected_count integer;
  inserted_count integer;
BEGIN
  IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Matches payload must be an array';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sdsap_season_setup:' || p_season_id::text, 0));

  SELECT status INTO season_status
  FROM public.seasons
  WHERE id = p_season_id
  FOR UPDATE;

  IF season_status IS NULL THEN
    RAISE EXCEPTION 'Season % was not found', p_season_id;
  END IF;
  IF season_status <> 'active' THEN
    RAISE EXCEPTION 'Only the active season can have matches created';
  END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id) THEN
    RAISE EXCEPTION 'This season already has matches';
  END IF;

  SELECT count(*) INTO team_count
  FROM public.teams
  WHERE season_id = p_season_id;

  IF team_count < 2 THEN
    RAISE EXCEPTION 'Need at least 2 teams to create matches';
  END IF;

  match_count := jsonb_array_length(p_matches);
  expected_count := team_count * (team_count - 1) / 2;
  IF match_count <> expected_count THEN
    RAISE EXCEPTION 'Expected % matches for % teams, received %',
      expected_count, team_count, match_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_matches) AS fixture(
      home_team_id uuid,
      away_team_id uuid,
      round_number integer
    )
    LEFT JOIN public.teams AS home
      ON home.id = fixture.home_team_id AND home.season_id = p_season_id
    LEFT JOIN public.teams AS away
      ON away.id = fixture.away_team_id AND away.season_id = p_season_id
    WHERE home.id IS NULL
      OR away.id IS NULL
      OR fixture.home_team_id = fixture.away_team_id
      OR fixture.round_number IS NULL
      OR fixture.round_number < 1
  ) THEN
    RAISE EXCEPTION 'One or more fixtures are invalid for this season';
  END IF;

  IF (
    SELECT count(*)
    FROM (
      SELECT LEAST(home_team_id, away_team_id), GREATEST(home_team_id, away_team_id)
      FROM jsonb_to_recordset(p_matches) AS fixture(
        home_team_id uuid,
        away_team_id uuid,
        round_number integer
      )
      GROUP BY LEAST(home_team_id, away_team_id), GREATEST(home_team_id, away_team_id)
    ) AS unique_pairs
  ) <> expected_count THEN
    RAISE EXCEPTION 'Fixtures must contain every team pairing exactly once';
  END IF;

  INSERT INTO public.matches (
    season_id,
    home_team_id,
    away_team_id,
    round_number,
    status
  )
  SELECT
    p_season_id,
    fixture.home_team_id,
    fixture.away_team_id,
    fixture.round_number,
    'scheduled'
  FROM jsonb_to_recordset(p_matches) AS fixture(
    home_team_id uuid,
    away_team_id uuid,
    round_number integer
  );

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_all_season_teams_atomic(
  p_season_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  season_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sdsap_season_setup:' || p_season_id::text, 0));

  SELECT status INTO season_status
  FROM public.seasons
  WHERE id = p_season_id
  FOR UPDATE;

  IF season_status IS NULL THEN
    RAISE EXCEPTION 'Season % was not found', p_season_id;
  END IF;
  IF season_status <> 'active' THEN
    RAISE EXCEPTION 'Only the active season can have its teams deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE season_id = p_season_id
      AND status IN ('completed', 'forfeit')
  ) THEN
    RAISE EXCEPTION 'Cannot delete teams after results have been recorded';
  END IF;

  DELETE FROM public.matches WHERE season_id = p_season_id;
  DELETE FROM public.teams WHERE season_id = p_season_id;
END;
$$;
