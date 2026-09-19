-- Multi-league ownership, league-scoped ratings, administrator-only writes,
-- and season-scoped rotation events.

CREATE TABLE public.leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  logo_url text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX leagues_one_default_idx
  ON public.leagues (is_default)
  WHERE is_default;

INSERT INTO public.leagues (id, slug, name, is_default)
VALUES ('11111111-1111-4111-8111-111111111111', 'sdsap', 'SDSAP League', true);

CREATE OR REPLACE FUNCTION public.keep_league_slug_stable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'League links are permanent; the slug cannot be changed';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leagues_keep_slug_stable
BEFORE UPDATE ON public.leagues
FOR EACH ROW EXECUTE FUNCTION public.keep_league_slug_stable();

ALTER TABLE public.seasons
  ADD COLUMN league_id uuid REFERENCES public.leagues(id) ON DELETE RESTRICT;

UPDATE public.seasons
SET league_id = '11111111-1111-4111-8111-111111111111'
WHERE league_id IS NULL;

ALTER TABLE public.seasons ALTER COLUMN league_id SET NOT NULL;
DROP INDEX IF EXISTS public.idx_seasons_one_active;
CREATE UNIQUE INDEX seasons_one_active_per_league_idx
  ON public.seasons (league_id)
  WHERE status = 'active';
CREATE INDEX seasons_league_starts_idx
  ON public.seasons (league_id, starts_at DESC);

CREATE TABLE public.league_players (
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  pool_player_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  rating double precision NOT NULL DEFAULT 1500,
  rating_deviation double precision NOT NULL DEFAULT 350,
  volatility double precision NOT NULL DEFAULT 0.06,
  initial_rating double precision NOT NULL DEFAULT 1500,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, pool_player_id)
);

CREATE INDEX league_players_pool_player_idx
  ON public.league_players (pool_player_id);

INSERT INTO public.league_players (
  league_id, pool_player_id, status, rating,
  rating_deviation, volatility, initial_rating, created_at
)
SELECT
  '11111111-1111-4111-8111-111111111111', id, status, rating,
  rating_deviation, volatility, initial_rating, created_at
FROM public.player_pool;

-- Player identity is shared across every league. Keep the denormalized team
-- roster name in sync so a single rename is reflected in historical pages too.
CREATE OR REPLACE FUNCTION public.sync_shared_player_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.players
    SET name = NEW.name
    WHERE pool_player_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_shared_player_name_trigger ON public.player_pool;
CREATE TRIGGER sync_shared_player_name_trigger
AFTER UPDATE OF name ON public.player_pool
FOR EACH ROW
EXECUTE FUNCTION public.sync_shared_player_name();

ALTER TABLE public.rating_history
  ADD COLUMN league_id uuid REFERENCES public.leagues(id) ON DELETE CASCADE;

UPDATE public.rating_history AS history
SET league_id = season.league_id
FROM public.matches AS match
JOIN public.seasons AS season ON season.id = match.season_id
WHERE history.match_id = match.id
  AND history.league_id IS NULL;

UPDATE public.rating_history
SET league_id = '11111111-1111-4111-8111-111111111111'
WHERE league_id IS NULL;

ALTER TABLE public.rating_history ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE public.rating_history
  ADD CONSTRAINT rating_history_league_player_fkey
  FOREIGN KEY (league_id, pool_player_id)
  REFERENCES public.league_players (league_id, pool_player_id)
  ON DELETE CASCADE;

DROP INDEX IF EXISTS public.idx_rating_history_player_seq;
CREATE INDEX rating_history_league_player_seq_idx
  ON public.rating_history (league_id, pool_player_id, sequence);

ALTER TABLE public.rating_state
  ADD COLUMN league_id uuid REFERENCES public.leagues(id) ON DELETE CASCADE;
UPDATE public.rating_state
SET league_id = '11111111-1111-4111-8111-111111111111'
WHERE league_id IS NULL;
ALTER TABLE public.rating_state ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE public.rating_state DROP CONSTRAINT rating_state_pkey;
ALTER TABLE public.rating_state DROP COLUMN id;
ALTER TABLE public.rating_state ADD PRIMARY KEY (league_id);

ALTER TABLE public.rotation_events
  ADD COLUMN season_id uuid REFERENCES public.seasons(id) ON DELETE CASCADE;

INSERT INTO public.seasons (league_id, name, status)
SELECT
  '11111111-1111-4111-8111-111111111111',
  'Season 1',
  'active'
WHERE EXISTS (SELECT 1 FROM public.rotation_events)
  AND NOT EXISTS (
    SELECT 1 FROM public.seasons
    WHERE league_id = '11111111-1111-4111-8111-111111111111'
  );

UPDATE public.rotation_events
SET season_id = COALESCE(
  (
    SELECT id FROM public.seasons
    WHERE league_id = '11111111-1111-4111-8111-111111111111'
      AND status = 'active'
    LIMIT 1
  ),
  (
    SELECT id FROM public.seasons
    WHERE league_id = '11111111-1111-4111-8111-111111111111'
    ORDER BY starts_at DESC
    LIMIT 1
  )
)
WHERE season_id IS NULL;

ALTER TABLE public.rotation_events ALTER COLUMN season_id SET NOT NULL;
DROP INDEX IF EXISTS public.rotation_events_singleton_idx;
ALTER TABLE public.rotation_events DROP COLUMN singleton;
CREATE UNIQUE INDEX rotation_events_one_per_season_idx
  ON public.rotation_events (season_id);

-- One rating revision stream per league.
DROP FUNCTION IF EXISTS public.save_match_and_ratings_atomic(
  uuid, text, uuid, integer, integer, uuid[], uuid[], timestamptz, jsonb, jsonb, bigint
);
DROP FUNCTION IF EXISTS public.replace_ratings_atomic(jsonb, jsonb, bigint);
DROP FUNCTION IF EXISTS public.claim_rating_revision(bigint);

CREATE FUNCTION public.claim_rating_revision(
  p_league_id uuid,
  p_expected_revision bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  current_revision bigint;
  next_revision bigint;
BEGIN
  SELECT revision INTO current_revision
  FROM public.rating_state
  WHERE league_id = p_league_id
  FOR UPDATE;

  IF current_revision IS NULL THEN
    RAISE EXCEPTION 'Rating state for league % was not found', p_league_id;
  END IF;
  IF current_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Rating revision conflict: expected %, current %',
      p_expected_revision, current_revision
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.rating_state
  SET revision = revision + 1
  WHERE league_id = p_league_id
  RETURNING revision INTO next_revision;
  RETURN next_revision;
END;
$$;

CREATE FUNCTION public.replace_ratings_atomic(
  p_league_id uuid,
  p_history_rows jsonb,
  p_player_ratings jsonb,
  p_expected_revision bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  history_count integer;
  rating_count integer;
  updated_count integer;
  next_revision bigint;
BEGIN
  IF jsonb_typeof(p_history_rows) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_player_ratings) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rating replacement payloads must be arrays';
  END IF;

  SELECT count(*) INTO history_count FROM jsonb_array_elements(p_history_rows);
  SELECT count(*) INTO rating_count FROM jsonb_array_elements(p_player_ratings);
  IF history_count = 0 OR rating_count = 0 THEN
    RAISE EXCEPTION 'Rating replacement payloads cannot be empty';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('league_replace_ratings:' || p_league_id::text, 0)
  );
  next_revision := public.claim_rating_revision(p_league_id, p_expected_revision);

  DELETE FROM public.rating_history WHERE league_id = p_league_id;

  INSERT INTO public.rating_history (
    league_id, pool_player_id, match_id, rating,
    rating_deviation, sequence, recorded_at
  )
  SELECT
    p_league_id, row.pool_player_id, row.match_id, row.rating,
    row.rating_deviation, row.sequence, row.recorded_at
  FROM jsonb_to_recordset(p_history_rows) AS row(
    pool_player_id uuid,
    match_id uuid,
    rating double precision,
    rating_deviation double precision,
    sequence integer,
    recorded_at timestamptz
  );

  UPDATE public.league_players AS player
  SET
    rating = replacement.rating,
    rating_deviation = replacement.rating_deviation,
    volatility = replacement.volatility
  FROM jsonb_to_recordset(p_player_ratings) AS replacement(
    id uuid,
    rating double precision,
    rating_deviation double precision,
    volatility double precision
  )
  WHERE player.league_id = p_league_id
    AND player.pool_player_id = replacement.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> rating_count THEN
    RAISE EXCEPTION 'Expected to update % league players, updated %',
      rating_count, updated_count;
  END IF;

  RETURN next_revision;
END;
$$;

CREATE FUNCTION public.save_match_and_ratings_atomic(
  p_league_id uuid,
  p_match_id uuid,
  p_status text,
  p_winner_team_id uuid,
  p_home_score integer,
  p_away_score integer,
  p_home_pool_player_ids uuid[],
  p_away_pool_player_ids uuid[],
  p_result_recorded_at timestamptz,
  p_history_rows jsonb,
  p_player_ratings jsonb,
  p_expected_revision bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count integer;
  claimed_revision bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('league_replace_ratings:' || p_league_id::text, 0)
  );
  claimed_revision := public.claim_rating_revision(p_league_id, p_expected_revision);

  UPDATE public.matches AS match
  SET
    status = p_status,
    winner_team_id = p_winner_team_id,
    home_score = p_home_score,
    away_score = p_away_score,
    home_pool_player_ids = p_home_pool_player_ids,
    away_pool_player_ids = p_away_pool_player_ids,
    result_recorded_at = p_result_recorded_at
  FROM public.seasons AS season
  WHERE match.id = p_match_id
    AND season.id = match.season_id
    AND season.league_id = p_league_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Match % was not found in league %', p_match_id, p_league_id;
  END IF;

  PERFORM public.replace_ratings_atomic(
    p_league_id, p_history_rows, p_player_ratings, claimed_revision
  );
END;
$$;

-- Team setup now checks league membership rather than the legacy global status.
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
  season_league_id uuid;
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended('league_season_setup:' || p_season_id::text, 0)
  );

  SELECT status, league_id INTO season_status, season_league_id
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

    IF team_name = '' THEN RAISE EXCEPTION 'Team name cannot be empty'; END IF;
    IF cardinality(pool_ids) <> 2 OR pool_ids[1] = pool_ids[2] THEN
      RAISE EXCEPTION 'A team must have exactly 2 different players';
    END IF;

    IF target_team_id IS NULL THEN
      IF team_color IS NULL THEN RAISE EXCEPTION 'Team color cannot be empty'; END IF;
      INSERT INTO public.teams (season_id, name, color)
      VALUES (p_season_id, team_name, team_color)
      RETURNING id INTO target_team_id;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.teams
      WHERE id = target_team_id AND season_id = p_season_id
    ) THEN
      IF team_color IS NULL THEN RAISE EXCEPTION 'Team color cannot be empty'; END IF;
      INSERT INTO public.teams (id, season_id, name, color)
      VALUES (target_team_id, p_season_id, team_name, team_color);
    ELSE
      UPDATE public.teams
      SET name = team_name, color = COALESCE(team_color, color)
      WHERE id = target_team_id AND season_id = p_season_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Team % was not found in this season', target_team_id;
      END IF;
      DELETE FROM public.players WHERE team_id = target_team_id;
    END IF;

    FOREACH pool_id IN ARRAY pool_ids
    LOOP
      SELECT identity.name INTO pool_name
      FROM public.player_pool AS identity
      JOIN public.league_players AS membership
        ON membership.pool_player_id = identity.id
       AND membership.league_id = season_league_id
      WHERE identity.id = pool_id
        AND membership.status = 'active';

      IF pool_name IS NULL THEN
        RAISE EXCEPTION 'Player % was not found or is inactive in this league', pool_id;
      END IF;

      INSERT INTO public.players (name, team_id, pool_player_id, season_id)
      VALUES (pool_name, target_team_id, pool_id, p_season_id);
    END LOOP;
    saved_team_ids := array_append(saved_team_ids, target_team_id);
  END LOOP;

  RETURN saved_team_ids;
END;
$$;

-- Atomic empty-league setup, including the first season, roster, teams and fixtures.
CREATE FUNCTION public.create_league_atomic(
  p_league_id uuid,
  p_slug text,
  p_name text,
  p_season_id uuid,
  p_season_name text,
  p_players jsonb,
  p_teams jsonb,
  p_matches jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  player_payload jsonb;
  player_id uuid;
  player_name text;
  initial_rating double precision;
  is_new boolean;
  player_sequence integer := 0;
BEGIN
  IF btrim(p_name) = '' OR btrim(p_season_name) = '' THEN
    RAISE EXCEPTION 'League and season names are required';
  END IF;
  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_players) < 4 THEN
    RAISE EXCEPTION 'A league needs at least four players';
  END IF;
  IF jsonb_typeof(p_teams) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_teams) < 2 THEN
    RAISE EXCEPTION 'A league needs at least two teams';
  END IF;

  INSERT INTO public.leagues (id, slug, name)
  VALUES (p_league_id, lower(btrim(p_slug)), btrim(p_name));
  INSERT INTO public.seasons (id, league_id, name, status)
  VALUES (p_season_id, p_league_id, btrim(p_season_name), 'active');
  INSERT INTO public.rating_state (league_id, revision)
  VALUES (p_league_id, 0);

  FOR player_payload IN SELECT value FROM jsonb_array_elements(p_players)
  LOOP
    player_id := (player_payload->>'id')::uuid;
    player_name := btrim(COALESCE(player_payload->>'name', ''));
    initial_rating := LEAST(
      2500,
      GREATEST(800, COALESCE((player_payload->>'initial_rating')::double precision, 1500))
    );
    is_new := COALESCE((player_payload->>'is_new')::boolean, false);

    IF is_new THEN
      IF player_name = '' THEN RAISE EXCEPTION 'Player name cannot be empty'; END IF;
      INSERT INTO public.player_pool (
        id, name, status, rating, rating_deviation, volatility, initial_rating
      ) VALUES (
        player_id, player_name, 'active', initial_rating, 350, 0.06, initial_rating
      );
    ELSIF NOT EXISTS (SELECT 1 FROM public.player_pool WHERE id = player_id) THEN
      RAISE EXCEPTION 'Shared player % was not found', player_id;
    END IF;

    INSERT INTO public.league_players (
      league_id, pool_player_id, status, rating,
      rating_deviation, volatility, initial_rating
    ) VALUES (
      p_league_id, player_id, 'active', initial_rating, 350, 0.06, initial_rating
    );

    INSERT INTO public.rating_history (
      league_id, pool_player_id, match_id, rating,
      rating_deviation, sequence, recorded_at
    ) VALUES (
      p_league_id, player_id, NULL, initial_rating,
      350, player_sequence, now()
    );
    player_sequence := player_sequence + 1;
  END LOOP;

  PERFORM public.save_season_teams_atomic(p_season_id, p_teams);
  PERFORM public.create_season_matches_atomic(p_season_id, p_matches);

  RETURN jsonb_build_object(
    'league_id', p_league_id,
    'season_id', p_season_id,
    'slug', lower(btrim(p_slug))
  );
END;
$$;

-- Scope the standalone rotation planner to the selected season.
DROP FUNCTION IF EXISTS public.replace_rotation_event_atomic(
  uuid, text, integer, integer, bigint, jsonb, jsonb
);

CREATE FUNCTION public.replace_rotation_event_atomic(
  p_event_id uuid,
  p_season_id uuid,
  p_name text,
  p_matches_per_player integer,
  p_court_count integer,
  p_schedule_seed bigint,
  p_players jsonb,
  p_matches jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_player_count integer;
  v_match_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('rotation-season:' || p_season_id::text, 0)
  );
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id) THEN
    RAISE EXCEPTION 'Season % was not found', p_season_id;
  END IF;

  v_player_count := jsonb_array_length(p_players);
  v_match_count := jsonb_array_length(p_matches);
  IF v_player_count < 4 THEN RAISE EXCEPTION 'Enter at least 4 players'; END IF;
  IF p_matches_per_player < 1 OR p_matches_per_player >= v_player_count THEN
    RAISE EXCEPTION 'Invalid matches per player';
  END IF;
  IF (v_player_count * p_matches_per_player) % 4 <> 0 THEN
    RAISE EXCEPTION 'Player appearances must be divisible by 4';
  END IF;
  IF p_court_count < 1 OR p_court_count > floor(v_player_count / 4.0) THEN
    RAISE EXCEPTION 'Invalid court count';
  END IF;
  IF v_match_count <> (v_player_count * p_matches_per_player) / 4 THEN
    RAISE EXCEPTION 'Schedule has the wrong number of matches';
  END IF;

  DELETE FROM public.rotation_events WHERE season_id = p_season_id;
  INSERT INTO public.rotation_events (
    id, season_id, name, matches_per_player,
    court_count, schedule_seed, status
  ) VALUES (
    p_event_id, p_season_id, btrim(p_name), p_matches_per_player,
    p_court_count, p_schedule_seed, 'draft'
  );

  INSERT INTO public.rotation_players (id, event_id, name, display_order)
  SELECT
    (item->>'id')::uuid, p_event_id, btrim(item->>'name'),
    (item->>'display_order')::integer
  FROM jsonb_array_elements(p_players) AS item;

  INSERT INTO public.rotation_matches (
    id, event_id, sequence_number,
    team_a_player_1_id, team_a_player_2_id,
    team_b_player_1_id, team_b_player_2_id
  )
  SELECT
    (item->>'id')::uuid, p_event_id, (item->>'sequence_number')::integer,
    (item->>'team_a_player_1_id')::uuid,
    (item->>'team_a_player_2_id')::uuid,
    (item->>'team_b_player_1_id')::uuid,
    (item->>'team_b_player_2_id')::uuid
  FROM jsonb_array_elements(p_matches) AS item;

  IF EXISTS (
    WITH appearances AS (
      SELECT team_a_player_1_id AS player_id FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_a_player_2_id FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_b_player_1_id FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_b_player_2_id FROM public.rotation_matches WHERE event_id = p_event_id
    ), counts AS (
      SELECT player_id, count(*) AS played FROM appearances GROUP BY player_id
    )
    SELECT 1
    FROM public.rotation_players AS player
    LEFT JOIN counts ON counts.player_id = player.id
    WHERE player.event_id = p_event_id
      AND coalesce(counts.played, 0) <> p_matches_per_player
  ) THEN
    RAISE EXCEPTION 'Every player must have the requested number of matches';
  END IF;

  IF EXISTS (
    WITH partnerships AS (
      SELECT least(team_a_player_1_id, team_a_player_2_id) AS first_id,
             greatest(team_a_player_1_id, team_a_player_2_id) AS second_id
      FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL
      SELECT least(team_b_player_1_id, team_b_player_2_id),
             greatest(team_b_player_1_id, team_b_player_2_id)
      FROM public.rotation_matches WHERE event_id = p_event_id
    )
    SELECT 1 FROM partnerships GROUP BY first_id, second_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Partners cannot repeat';
  END IF;

  RETURN p_event_id;
END;
$$;

-- Public reads remain open; every write requires an authenticated admin claim.
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_players ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  target_table text;
  existing_policy record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'leagues', 'seasons', 'teams', 'players', 'matches', 'player_pool',
    'league_players', 'rating_history', 'rating_state',
    'rotation_events', 'rotation_players', 'rotation_matches'
  ]
  LOOP
    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY %I ON public.%I', existing_policy.policyname, target_table
      );
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      'Public read ' || target_table,
      target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((select auth.jwt()->''app_metadata''->>''role'') = ''admin'') WITH CHECK ((select auth.jwt()->''app_metadata''->>''role'') = ''admin'')',
      'Admin write ' || target_table,
      target_table
    );
  END LOOP;
END;
$$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.leagues, public.seasons, public.teams, public.players,
     public.matches, public.player_pool, public.league_players,
     public.rating_history, public.rating_state,
     public.rotation_events, public.rotation_players, public.rotation_matches
  FROM anon;

GRANT SELECT
  ON public.leagues, public.seasons, public.teams, public.players,
     public.matches, public.player_pool, public.league_players,
     public.rating_history, public.rating_state,
     public.rotation_events, public.rotation_players, public.rotation_matches
  TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE
  ON public.leagues, public.seasons, public.teams, public.players,
     public.matches, public.player_pool, public.league_players,
     public.rating_history, public.rating_state,
     public.rotation_events, public.rotation_players, public.rotation_matches
  TO authenticated;

-- Public bucket for league marks; only administrator JWTs may change objects.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'league-logos', 'league-logos', true, 2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Admin upload league logos" ON storage.objects;
DROP POLICY IF EXISTS "Admin select league logos" ON storage.objects;
DROP POLICY IF EXISTS "Admin update league logos" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete league logos" ON storage.objects;

CREATE POLICY "Admin select league logos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'league-logos'
  AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
);
CREATE POLICY "Admin upload league logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'league-logos'
  AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
);
CREATE POLICY "Admin update league logos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'league-logos'
  AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
)
WITH CHECK (
  bucket_id = 'league-logos'
  AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
);
CREATE POLICY "Admin delete league logos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'league-logos'
  AND (select auth.jwt()->'app_metadata'->>'role') = 'admin'
);

-- RPC execution is never available anonymously. RLS still checks the admin claim.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Realtime continues to publish the same tables; league filtering happens by
-- season/event identifiers in clients.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'leagues'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leagues;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'league_players'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.league_players;
  END IF;
END;
$$;
