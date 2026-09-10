-- Standalone random-doubles planner. These tables do not reference league data.

CREATE TABLE rotation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true CHECK (singleton),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  matches_per_player smallint NOT NULL CHECK (matches_per_player >= 1),
  court_count smallint NOT NULL CHECK (court_count >= 1),
  schedule_seed bigint NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rotation_events_singleton_idx ON rotation_events (singleton);

CREATE TABLE rotation_players (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES rotation_events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  display_order smallint NOT NULL CHECK (display_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, display_order)
);

CREATE UNIQUE INDEX rotation_players_unique_name_idx
  ON rotation_players (event_id, lower(btrim(name)));
CREATE INDEX rotation_players_event_idx ON rotation_players (event_id);

CREATE TABLE rotation_matches (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES rotation_events(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  team_a_player_1_id uuid NOT NULL REFERENCES rotation_players(id) ON DELETE CASCADE,
  team_a_player_2_id uuid NOT NULL REFERENCES rotation_players(id) ON DELETE CASCADE,
  team_b_player_1_id uuid NOT NULL REFERENCES rotation_players(id) ON DELETE CASCADE,
  team_b_player_2_id uuid NOT NULL REFERENCES rotation_players(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'playing', 'completed')),
  court_number smallint,
  team_a_score smallint,
  team_b_score smallint,
  result_recorded_at timestamptz,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, sequence_number),
  CHECK (
    team_a_player_1_id <> team_a_player_2_id AND
    team_a_player_1_id <> team_b_player_1_id AND
    team_a_player_1_id <> team_b_player_2_id AND
    team_a_player_2_id <> team_b_player_1_id AND
    team_a_player_2_id <> team_b_player_2_id AND
    team_b_player_1_id <> team_b_player_2_id
  ),
  CHECK (
    (status = 'available' AND court_number IS NULL AND team_a_score IS NULL AND team_b_score IS NULL AND result_recorded_at IS NULL) OR
    (status = 'playing' AND court_number IS NOT NULL AND team_a_score IS NULL AND team_b_score IS NULL AND result_recorded_at IS NULL) OR
    (status = 'completed' AND court_number IS NULL AND team_a_score IS NOT NULL AND team_b_score IS NOT NULL AND result_recorded_at IS NOT NULL)
  ),
  CHECK (
    status <> 'completed' OR (
      team_a_score >= 0 AND
      team_b_score >= 0 AND
      team_a_score <> team_b_score AND
      greatest(team_a_score, team_b_score) >= 11 AND
      abs(team_a_score - team_b_score) >= 2
    )
  )
);

CREATE INDEX rotation_matches_event_status_idx
  ON rotation_matches (event_id, status, sequence_number);
CREATE UNIQUE INDEX rotation_matches_active_court_idx
  ON rotation_matches (event_id, court_number)
  WHERE status = 'playing';

ALTER TABLE rotation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotation_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotation_matches ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON rotation_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rotation_players TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rotation_matches TO anon, authenticated;

CREATE POLICY "Public rotation event access"
  ON rotation_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public rotation player access"
  ON rotation_players FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Public rotation match access"
  ON rotation_matches FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION replace_rotation_event_atomic(
  p_event_id uuid,
  p_name text,
  p_matches_per_player integer,
  p_court_count integer,
  p_schedule_seed bigint,
  p_players jsonb,
  p_matches jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_player_count integer;
  v_match_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rotation-current-event'));
  v_player_count := jsonb_array_length(p_players);
  v_match_count := jsonb_array_length(p_matches);

  IF v_player_count < 4 THEN
    RAISE EXCEPTION 'Enter at least 4 players';
  END IF;
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

  DELETE FROM rotation_events WHERE id IS NOT NULL;
  INSERT INTO rotation_events (
    id, name, matches_per_player, court_count, schedule_seed, status
  ) VALUES (
    p_event_id, btrim(p_name), p_matches_per_player, p_court_count, p_schedule_seed, 'draft'
  );

  INSERT INTO rotation_players (id, event_id, name, display_order)
  SELECT
    (item->>'id')::uuid,
    p_event_id,
    btrim(item->>'name'),
    (item->>'display_order')::integer
  FROM jsonb_array_elements(p_players) AS item;

  INSERT INTO rotation_matches (
    id,
    event_id,
    sequence_number,
    team_a_player_1_id,
    team_a_player_2_id,
    team_b_player_1_id,
    team_b_player_2_id
  )
  SELECT
    (item->>'id')::uuid,
    p_event_id,
    (item->>'sequence_number')::integer,
    (item->>'team_a_player_1_id')::uuid,
    (item->>'team_a_player_2_id')::uuid,
    (item->>'team_b_player_1_id')::uuid,
    (item->>'team_b_player_2_id')::uuid
  FROM jsonb_array_elements(p_matches) AS item;

  IF EXISTS (
    WITH appearances AS (
      SELECT team_a_player_1_id AS player_id FROM rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_a_player_2_id FROM rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_b_player_1_id FROM rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_b_player_2_id FROM rotation_matches WHERE event_id = p_event_id
    ), counts AS (
      SELECT player_id, count(*) AS played FROM appearances GROUP BY player_id
    )
    SELECT 1
    FROM rotation_players player
    LEFT JOIN counts ON counts.player_id = player.id
    WHERE player.event_id = p_event_id
      AND coalesce(counts.played, 0) <> p_matches_per_player
  ) THEN
    RAISE EXCEPTION 'Every player must have the requested number of matches';
  END IF;

  IF EXISTS (
    WITH partnerships AS (
      SELECT
        least(team_a_player_1_id, team_a_player_2_id) AS first_id,
        greatest(team_a_player_1_id, team_a_player_2_id) AS second_id
      FROM rotation_matches WHERE event_id = p_event_id
      UNION ALL
      SELECT
        least(team_b_player_1_id, team_b_player_2_id),
        greatest(team_b_player_1_id, team_b_player_2_id)
      FROM rotation_matches WHERE event_id = p_event_id
    )
    SELECT 1 FROM partnerships GROUP BY first_id, second_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Partners cannot repeat';
  END IF;

  RETURN p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION start_rotation_match_atomic(
  p_match_id uuid,
  p_court_number integer,
  p_expected_revision integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_match rotation_matches%ROWTYPE;
  v_court_count integer;
BEGIN
  SELECT * INTO v_match
  FROM rotation_matches
  WHERE id = p_match_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found'; END IF;
  SELECT court_count INTO v_court_count
  FROM rotation_events
  WHERE id = v_match.event_id
  FOR UPDATE;
  IF v_match.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Rotation match changed on another device';
  END IF;
  IF v_match.status <> 'available' THEN RAISE EXCEPTION 'Match is not available'; END IF;
  IF p_court_number < 1 OR p_court_number > v_court_count THEN
    RAISE EXCEPTION 'Court number is outside the event configuration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM rotation_matches
    WHERE event_id = v_match.event_id AND status = 'playing' AND court_number = p_court_number
  ) THEN
    RAISE EXCEPTION 'Court is already occupied';
  END IF;
  IF EXISTS (
    SELECT 1 FROM rotation_matches active_match
    WHERE active_match.event_id = v_match.event_id
      AND active_match.status = 'playing'
      AND ARRAY[
        active_match.team_a_player_1_id,
        active_match.team_a_player_2_id,
        active_match.team_b_player_1_id,
        active_match.team_b_player_2_id
      ] && ARRAY[
        v_match.team_a_player_1_id,
        v_match.team_a_player_2_id,
        v_match.team_b_player_1_id,
        v_match.team_b_player_2_id
      ]
  ) THEN
    RAISE EXCEPTION 'A player in this match is already playing';
  END IF;

  UPDATE rotation_matches
  SET status = 'playing', court_number = p_court_number,
      revision = revision + 1, updated_at = now()
  WHERE id = p_match_id;
  UPDATE rotation_events SET status = 'active', updated_at = now()
  WHERE id = v_match.event_id;
END;
$$;

CREATE OR REPLACE FUNCTION return_rotation_match_to_queue_atomic(
  p_match_id uuid,
  p_expected_revision integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_match rotation_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_match FROM rotation_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF v_match.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Rotation match changed on another device';
  END IF;
  IF v_match.status <> 'playing' THEN RAISE EXCEPTION 'Only a playing match can return to the queue'; END IF;
  UPDATE rotation_matches
  SET status = 'available', court_number = NULL,
      revision = revision + 1, updated_at = now()
  WHERE id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION save_rotation_match_result_atomic(
  p_match_id uuid,
  p_team_a_score integer,
  p_team_b_score integer,
  p_expected_revision integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_match rotation_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_match FROM rotation_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found'; END IF;
  IF v_match.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Rotation match changed on another device';
  END IF;
  IF v_match.status NOT IN ('playing', 'completed') THEN
    RAISE EXCEPTION 'Start this match before recording its score';
  END IF;
  IF p_team_a_score < 0 OR p_team_b_score < 0 OR p_team_a_score = p_team_b_score OR
     greatest(p_team_a_score, p_team_b_score) < 11 OR abs(p_team_a_score - p_team_b_score) < 2 THEN
    RAISE EXCEPTION 'A standard game requires at least 11 points and a 2-point winning margin';
  END IF;

  UPDATE rotation_matches
  SET status = 'completed', court_number = NULL,
      team_a_score = p_team_a_score, team_b_score = p_team_b_score,
      result_recorded_at = coalesce(result_recorded_at, now()),
      revision = revision + 1, updated_at = now()
  WHERE id = p_match_id;

  UPDATE rotation_events
  SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM rotation_matches
          WHERE event_id = v_match.event_id AND status <> 'completed'
        ) THEN 'active'
        ELSE 'completed'
      END,
      updated_at = now()
  WHERE id = v_match.event_id;
END;
$$;

CREATE OR REPLACE FUNCTION reset_rotation_event_atomic(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rotation-current-event'));
  DELETE FROM rotation_events WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION replace_rotation_event_atomic(uuid, text, integer, integer, bigint, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_rotation_match_atomic(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION return_rotation_match_to_queue_atomic(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_rotation_match_result_atomic(uuid, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reset_rotation_event_atomic(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION replace_rotation_event_atomic(uuid, text, integer, integer, bigint, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION start_rotation_match_atomic(uuid, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION return_rotation_match_to_queue_atomic(uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_rotation_match_result_atomic(uuid, integer, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION reset_rotation_event_atomic(uuid) TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rotation_events'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE rotation_events; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rotation_players'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE rotation_players; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rotation_matches'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE rotation_matches; END IF;
END $$;
