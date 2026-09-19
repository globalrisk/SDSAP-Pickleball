-- Standalone ranked-squad Team Duel format. This domain deliberately does not
-- reference leagues, seasons, league teams, ratings, or league matches.

CREATE TABLE public.team_duel_squads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX team_duel_squads_unique_name_idx
  ON public.team_duel_squads (lower(btrim(name)));

CREATE TABLE public.team_duel_squad_members (
  squad_id uuid NOT NULL REFERENCES public.team_duel_squads(id) ON DELETE CASCADE,
  rank_position smallint NOT NULL CHECK (rank_position BETWEEN 1 AND 6),
  pool_player_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (squad_id, rank_position),
  UNIQUE (squad_id, pool_player_id)
);

CREATE INDEX team_duel_squad_members_player_idx
  ON public.team_duel_squad_members (pool_player_id);

CREATE TABLE public.team_duel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date NOT NULL,
  title text CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 120),
  squad_a_id uuid NOT NULL REFERENCES public.team_duel_squads(id) ON DELETE RESTRICT,
  squad_b_id uuid NOT NULL REFERENCES public.team_duel_squads(id) ON DELETE RESTRICT,
  squad_a_name text,
  squad_b_name text,
  roster_size smallint CHECK (roster_size BETWEEN 4 AND 6),
  court_count smallint NOT NULL CHECK (court_count BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'tiebreak_required', 'completed')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CHECK (squad_a_id <> squad_b_id),
  CHECK (
    (status = 'draft' AND squad_a_name IS NULL AND squad_b_name IS NULL AND roster_size IS NULL
      AND started_at IS NULL AND completed_at IS NULL)
    OR
    (status IN ('active', 'tiebreak_required') AND squad_a_name IS NOT NULL
      AND squad_b_name IS NOT NULL AND roster_size IS NOT NULL
      AND started_at IS NOT NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND squad_a_name IS NOT NULL AND squad_b_name IS NOT NULL
      AND roster_size IS NOT NULL AND started_at IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX team_duel_one_live_event_idx
  ON public.team_duel_events ((true))
  WHERE status IN ('active', 'tiebreak_required');
CREATE INDEX team_duel_events_history_idx
  ON public.team_duel_events (event_date DESC, created_at DESC)
  WHERE status <> 'draft';

CREATE TABLE public.team_duel_event_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.team_duel_events(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('a', 'b')),
  rank_position smallint NOT NULL CHECK (rank_position BETWEEN 1 AND 6),
  pool_player_id uuid REFERENCES public.player_pool(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, side, rank_position),
  UNIQUE (event_id, side, pool_player_id)
);

CREATE INDEX team_duel_event_players_event_idx
  ON public.team_duel_event_players (event_id, side, rank_position);
CREATE INDEX team_duel_event_players_pool_idx
  ON public.team_duel_event_players (pool_player_id)
  WHERE pool_player_id IS NOT NULL;

CREATE TABLE public.team_duel_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.team_duel_events(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'tiebreak')),
  round_number smallint NOT NULL CHECK (round_number >= 1),
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  team_a_rank_1 smallint NOT NULL CHECK (team_a_rank_1 BETWEEN 1 AND 6),
  team_a_rank_2 smallint NOT NULL CHECK (team_a_rank_2 BETWEEN 1 AND 6),
  team_b_rank_1 smallint NOT NULL CHECK (team_b_rank_1 BETWEEN 1 AND 6),
  team_b_rank_2 smallint NOT NULL CHECK (team_b_rank_2 BETWEEN 1 AND 6),
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
  CHECK (team_a_rank_1 <> team_a_rank_2),
  CHECK (team_b_rank_1 <> team_b_rank_2),
  CHECK (
    kind = 'tiebreak' OR (
      least(team_a_rank_1, team_a_rank_2) = least(team_b_rank_1, team_b_rank_2)
      AND greatest(team_a_rank_1, team_a_rank_2) = greatest(team_b_rank_1, team_b_rank_2)
    )
  ),
  CHECK (
    (status = 'available' AND court_number IS NULL AND team_a_score IS NULL
      AND team_b_score IS NULL AND result_recorded_at IS NULL)
    OR
    (status = 'playing' AND court_number IS NOT NULL AND team_a_score IS NULL
      AND team_b_score IS NULL AND result_recorded_at IS NULL)
    OR
    (status = 'completed' AND court_number IS NULL AND team_a_score IS NOT NULL
      AND team_b_score IS NOT NULL AND result_recorded_at IS NOT NULL)
  ),
  CHECK (
    status <> 'completed' OR (
      team_a_score >= 0 AND team_b_score >= 0 AND team_a_score <> team_b_score
      AND greatest(team_a_score, team_b_score) >= 11
      AND abs(team_a_score - team_b_score) >= 2
    )
  )
);

CREATE INDEX team_duel_matches_event_idx
  ON public.team_duel_matches (event_id, status, sequence_number);
CREATE UNIQUE INDEX team_duel_matches_active_court_idx
  ON public.team_duel_matches (event_id, court_number)
  WHERE status = 'playing';

CREATE OR REPLACE FUNCTION public.check_team_duel_squad_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_squad_id uuid;
  v_count integer;
  v_min_rank integer;
  v_max_rank integer;
BEGIN
  IF TG_TABLE_NAME = 'team_duel_squads' THEN
    v_squad_id := coalesce(NEW.id, OLD.id);
  ELSIF TG_OP = 'DELETE' THEN
    v_squad_id := OLD.squad_id;
  ELSE
    v_squad_id := NEW.squad_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.team_duel_squads WHERE id = v_squad_id) THEN
    SELECT count(*), min(rank_position), max(rank_position)
    INTO v_count, v_min_rank, v_max_rank
    FROM public.team_duel_squad_members
    WHERE squad_id = v_squad_id;

    IF v_count NOT BETWEEN 4 AND 6 OR v_min_rank <> 1 OR v_max_rank <> v_count THEN
      RAISE EXCEPTION 'A Team Duel squad must contain 4, 5, or 6 contiguous ranked players'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER team_duel_squads_require_roster
AFTER INSERT OR UPDATE ON public.team_duel_squads
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_team_duel_squad_roster();

CREATE CONSTRAINT TRIGGER team_duel_members_preserve_roster
AFTER INSERT OR UPDATE OR DELETE ON public.team_duel_squad_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_team_duel_squad_roster();

CREATE OR REPLACE FUNCTION public.protect_team_duel_event_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'An active or completed Team Duel cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.event_date IS DISTINCT FROM OLD.event_date
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.squad_a_id IS DISTINCT FROM OLD.squad_a_id
    OR NEW.squad_b_id IS DISTINCT FROM OLD.squad_b_id
    OR NEW.squad_a_name IS DISTINCT FROM OLD.squad_a_name
    OR NEW.squad_b_name IS DISTINCT FROM OLD.squad_b_name
    OR NEW.roster_size IS DISTINCT FROM OLD.roster_size
    OR NEW.court_count IS DISTINCT FROM OLD.court_count
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
  ) THEN
    RAISE EXCEPTION 'An active or completed Team Duel snapshot is locked';
  END IF;
  IF OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A completed Team Duel is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER team_duel_events_lock_identity
BEFORE UPDATE OR DELETE ON public.team_duel_events
FOR EACH ROW EXECUTE FUNCTION public.protect_team_duel_event_identity();

CREATE OR REPLACE FUNCTION public.protect_team_duel_event_player_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.pool_player_id IS NOT NULL
    AND NEW.pool_player_id IS NULL
    AND NEW.id = OLD.id
    AND NEW.event_id = OLD.event_id
    AND NEW.side = OLD.side
    AND NEW.rank_position = OLD.rank_position
    AND NEW.display_name = OLD.display_name
    AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'An activated Team Duel roster snapshot is immutable';
END;
$$;

CREATE TRIGGER team_duel_event_players_lock_snapshot
BEFORE UPDATE OR DELETE ON public.team_duel_event_players
FOR EACH ROW EXECUTE FUNCTION public.protect_team_duel_event_player_snapshot();

CREATE OR REPLACE FUNCTION public.protect_team_duel_match_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An activated Team Duel match cannot be deleted';
  END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.round_number IS DISTINCT FROM OLD.round_number
    OR NEW.sequence_number IS DISTINCT FROM OLD.sequence_number
    OR NEW.team_a_rank_1 IS DISTINCT FROM OLD.team_a_rank_1
    OR NEW.team_a_rank_2 IS DISTINCT FROM OLD.team_a_rank_2
    OR NEW.team_b_rank_1 IS DISTINCT FROM OLD.team_b_rank_1
    OR NEW.team_b_rank_2 IS DISTINCT FROM OLD.team_b_rank_2
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Team Duel match identities are immutable';
  END IF;
  IF OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A completed Team Duel match is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER team_duel_matches_lock_identity
BEFORE UPDATE OR DELETE ON public.team_duel_matches
FOR EACH ROW EXECUTE FUNCTION public.protect_team_duel_match_identity();

CREATE OR REPLACE FUNCTION public.save_team_duel_squad_atomic(
  p_squad_id uuid,
  p_name text,
  p_pool_player_ids uuid[],
  p_expected_revision integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_revision integer;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('team-duel-squad:' || p_squad_id::text, 0));
  IF char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Squad name must contain between 1 and 120 characters';
  END IF;
  v_count := coalesce(array_length(p_pool_player_ids, 1), 0);
  IF v_count NOT BETWEEN 4 AND 6 THEN
    RAISE EXCEPTION 'A Team Duel squad must contain 4, 5, or 6 players';
  END IF;
  IF (SELECT count(DISTINCT player_id) FROM unnest(p_pool_player_ids) AS player_id) <> v_count THEN
    RAISE EXCEPTION 'Squad players must be unique';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_pool_player_ids) AS selected(player_id)
    LEFT JOIN public.player_pool AS player ON player.id = selected.player_id
    WHERE player.id IS NULL OR player.status <> 'active'
  ) THEN
    RAISE EXCEPTION 'Every squad member must be an active registered player';
  END IF;

  SELECT revision INTO v_revision
  FROM public.team_duel_squads
  WHERE id = p_squad_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_revision <> p_expected_revision THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Squad changed on another device';
    END IF;
    UPDATE public.team_duel_squads
    SET name = btrim(p_name), status = 'active', revision = revision + 1, updated_at = now()
    WHERE id = p_squad_id;
    DELETE FROM public.team_duel_squad_members WHERE squad_id = p_squad_id;
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Squad changed on another device';
    END IF;
    INSERT INTO public.team_duel_squads (id, name)
    VALUES (p_squad_id, btrim(p_name));
  END IF;

  INSERT INTO public.team_duel_squad_members (squad_id, rank_position, pool_player_id)
  SELECT p_squad_id, ordinal::smallint, player_id
  FROM unnest(p_pool_player_ids) WITH ORDINALITY AS selected(player_id, ordinal);
  RETURN p_squad_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_team_duel_squad_archived_atomic(
  p_squad_id uuid,
  p_archived boolean,
  p_expected_revision integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.team_duel_squads
  SET status = CASE WHEN p_archived THEN 'archived' ELSE 'active' END,
      revision = revision + 1,
      updated_at = now()
  WHERE id = p_squad_id AND revision = p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Squad changed on another device';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_team_duel_draft_atomic(
  p_event_id uuid,
  p_event_date date,
  p_title text,
  p_squad_a_id uuid,
  p_squad_b_id uuid,
  p_court_count integer,
  p_expected_revision integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_revision integer;
  v_size_a integer;
  v_size_b integer;
BEGIN
  IF p_squad_a_id = p_squad_b_id THEN RAISE EXCEPTION 'Choose two different squads'; END IF;
  IF p_title IS NOT NULL AND char_length(btrim(p_title)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Event title must contain between 1 and 120 characters';
  END IF;
  SELECT count(*) INTO v_size_a FROM public.team_duel_squad_members WHERE squad_id = p_squad_a_id;
  SELECT count(*) INTO v_size_b FROM public.team_duel_squad_members WHERE squad_id = p_squad_b_id;
  IF NOT EXISTS (SELECT 1 FROM public.team_duel_squads WHERE id = p_squad_a_id AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM public.team_duel_squads WHERE id = p_squad_b_id AND status = 'active')
  THEN RAISE EXCEPTION 'Both squads must be active'; END IF;
  IF v_size_a <> v_size_b OR v_size_a NOT BETWEEN 4 AND 6 THEN
    RAISE EXCEPTION 'Squads must contain the same supported number of players';
  END IF;
  IF p_court_count < 1 OR p_court_count > floor(v_size_a / 2.0) THEN
    RAISE EXCEPTION 'Court count is outside the supported range';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_duel_squad_members AS a
    JOIN public.team_duel_squad_members AS b USING (pool_player_id)
    WHERE a.squad_id = p_squad_a_id AND b.squad_id = p_squad_b_id
  ) THEN RAISE EXCEPTION 'Opposing squads cannot share a player'; END IF;

  SELECT revision INTO v_revision FROM public.team_duel_events WHERE id = p_event_id FOR UPDATE;
  IF FOUND THEN
    IF v_revision <> p_expected_revision THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Duel draft changed on another device';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.team_duel_events WHERE id = p_event_id AND status = 'draft') THEN
      RAISE EXCEPTION 'Only a draft Team Duel can be edited';
    END IF;
    UPDATE public.team_duel_events
    SET event_date = p_event_date,
        title = nullif(btrim(p_title), ''),
        squad_a_id = p_squad_a_id,
        squad_b_id = p_squad_b_id,
        court_count = p_court_count,
        revision = revision + 1,
        updated_at = now()
    WHERE id = p_event_id;
  ELSE
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Duel draft changed on another device';
    END IF;
    INSERT INTO public.team_duel_events (
      id, event_date, title, squad_a_id, squad_b_id, court_count
    ) VALUES (
      p_event_id, p_event_date, nullif(btrim(p_title), ''),
      p_squad_a_id, p_squad_b_id, p_court_count
    );
  END IF;
  RETURN p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_team_duel_draft_atomic(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.team_duel_events WHERE id = p_event_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a draft Team Duel can be deleted'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_team_duel_event_atomic(
  p_event_id uuid,
  p_expected_revision integer,
  p_matches jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event public.team_duel_events%ROWTYPE;
  v_size integer;
  v_size_b integer;
  v_expected_matches integer;
  v_expected_rounds integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('team-duel-live', 0));
  SELECT * INTO v_event FROM public.team_duel_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team Duel draft not found'; END IF;
  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft Team Duel can be activated'; END IF;
  IF v_event.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Duel draft changed on another device';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_duel_events
    WHERE status IN ('active', 'tiebreak_required') AND id <> p_event_id
  ) THEN RAISE EXCEPTION 'Another Team Duel is already live'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_duel_squads WHERE id = v_event.squad_a_id AND status = 'active')
    OR NOT EXISTS (SELECT 1 FROM public.team_duel_squads WHERE id = v_event.squad_b_id AND status = 'active')
  THEN RAISE EXCEPTION 'Both squads must be active'; END IF;

  SELECT count(*) INTO v_size FROM public.team_duel_squad_members WHERE squad_id = v_event.squad_a_id;
  SELECT count(*) INTO v_size_b FROM public.team_duel_squad_members WHERE squad_id = v_event.squad_b_id;
  IF v_size <> v_size_b OR v_size NOT BETWEEN 4 AND 6 THEN
    RAISE EXCEPTION 'Squads must contain the same supported number of players';
  END IF;
  IF v_event.court_count > floor(v_size / 2.0) THEN RAISE EXCEPTION 'Too many courts for this duel'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_duel_squad_members AS a
    JOIN public.team_duel_squad_members AS b USING (pool_player_id)
    WHERE a.squad_id = v_event.squad_a_id AND b.squad_id = v_event.squad_b_id
  ) THEN RAISE EXCEPTION 'Opposing squads cannot share a player'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_duel_squad_members AS member
    JOIN public.player_pool AS player ON player.id = member.pool_player_id
    WHERE member.squad_id IN (v_event.squad_a_id, v_event.squad_b_id)
      AND player.status <> 'active'
  ) THEN RAISE EXCEPTION 'Every squad member must remain an active registered player'; END IF;

  v_expected_matches := v_size * (v_size - 1) / 2;
  v_expected_rounds := CASE WHEN v_size % 2 = 0 THEN v_size - 1 ELSE v_size END;
  IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_matches) <> v_expected_matches
  THEN RAISE EXCEPTION 'Generated schedule has the wrong number of matches'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.team_duel_schedule_input (
    round_number integer,
    sequence_number integer,
    rank_1 integer,
    rank_2 integer
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.team_duel_schedule_input;
  INSERT INTO pg_temp.team_duel_schedule_input
  SELECT round_number, sequence_number, rank_1, rank_2
  FROM jsonb_to_recordset(p_matches) AS match(
    round_number integer,
    sequence_number integer,
    rank_1 integer,
    rank_2 integer
  );

  IF EXISTS (
    SELECT 1 FROM pg_temp.team_duel_schedule_input
    WHERE round_number NOT BETWEEN 1 AND v_expected_rounds
      OR sequence_number NOT BETWEEN 1 AND v_expected_matches
      OR rank_1 NOT BETWEEN 1 AND v_size OR rank_2 NOT BETWEEN 1 AND v_size
      OR rank_1 = rank_2
  ) THEN RAISE EXCEPTION 'Generated schedule contains an invalid rank or round'; END IF;
  IF (SELECT count(DISTINCT sequence_number) FROM pg_temp.team_duel_schedule_input) <> v_expected_matches
    OR (SELECT count(DISTINCT (least(rank_1, rank_2), greatest(rank_1, rank_2))) FROM pg_temp.team_duel_schedule_input) <> v_expected_matches
  THEN RAISE EXCEPTION 'Generated schedule must use every partnership exactly once'; END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT round_number, rank_position, count(*) AS appearances
      FROM (
        SELECT round_number, rank_1 AS rank_position FROM pg_temp.team_duel_schedule_input
        UNION ALL
        SELECT round_number, rank_2 FROM pg_temp.team_duel_schedule_input
      ) AS appearances
      GROUP BY round_number, rank_position
      HAVING count(*) > 1
    ) AS duplicate_round_player
  ) THEN RAISE EXCEPTION 'A player cannot appear twice in one round'; END IF;
  IF EXISTS (
    SELECT round_number FROM pg_temp.team_duel_schedule_input
    GROUP BY round_number HAVING count(*) <> floor(v_size / 2.0)
  ) OR (SELECT count(DISTINCT round_number) FROM pg_temp.team_duel_schedule_input) <> v_expected_rounds
  THEN RAISE EXCEPTION 'Every round must contain the expected number of matches'; END IF;

  INSERT INTO public.team_duel_event_players (
    event_id, side, rank_position, pool_player_id, display_name
  )
  SELECT p_event_id, 'a', member.rank_position, member.pool_player_id, player.name
  FROM public.team_duel_squad_members AS member
  JOIN public.player_pool AS player ON player.id = member.pool_player_id
  WHERE member.squad_id = v_event.squad_a_id
  UNION ALL
  SELECT p_event_id, 'b', member.rank_position, member.pool_player_id, player.name
  FROM public.team_duel_squad_members AS member
  JOIN public.player_pool AS player ON player.id = member.pool_player_id
  WHERE member.squad_id = v_event.squad_b_id;

  INSERT INTO public.team_duel_matches (
    event_id, round_number, sequence_number,
    team_a_rank_1, team_a_rank_2, team_b_rank_1, team_b_rank_2
  )
  SELECT p_event_id, round_number, sequence_number,
         rank_1, rank_2, rank_1, rank_2
  FROM pg_temp.team_duel_schedule_input
  ORDER BY sequence_number;

  UPDATE public.team_duel_events
  SET squad_a_name = (SELECT name FROM public.team_duel_squads WHERE id = v_event.squad_a_id),
      squad_b_name = (SELECT name FROM public.team_duel_squads WHERE id = v_event.squad_b_id),
      roster_size = v_size,
      status = 'active',
      started_at = now(),
      revision = revision + 1,
      updated_at = now()
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_team_duel_match_atomic(
  p_match_id uuid,
  p_court_number integer,
  p_expected_revision integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_match public.team_duel_matches%ROWTYPE;
  v_event public.team_duel_events%ROWTYPE;
BEGIN
  SELECT * INTO v_match FROM public.team_duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team Duel match not found'; END IF;
  SELECT * INTO v_event FROM public.team_duel_events WHERE id = v_match.event_id FOR UPDATE;
  IF v_event.status NOT IN ('active', 'tiebreak_required') THEN
    RAISE EXCEPTION 'This Team Duel is not live';
  END IF;
  IF v_match.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Team Duel match changed on another device';
  END IF;
  IF v_match.status <> 'available' THEN RAISE EXCEPTION 'Match is not available'; END IF;
  IF p_court_number NOT BETWEEN 1 AND v_event.court_count THEN
    RAISE EXCEPTION 'Court number is outside the duel configuration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_duel_matches
    WHERE event_id = v_match.event_id AND status = 'playing' AND court_number = p_court_number
  ) THEN RAISE EXCEPTION 'Court is already occupied'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_duel_matches AS playing
    WHERE playing.event_id = v_match.event_id AND playing.status = 'playing'
      AND (
        ARRAY[playing.team_a_rank_1, playing.team_a_rank_2]
          && ARRAY[v_match.team_a_rank_1, v_match.team_a_rank_2]
        OR ARRAY[playing.team_b_rank_1, playing.team_b_rank_2]
          && ARRAY[v_match.team_b_rank_1, v_match.team_b_rank_2]
      )
  ) THEN RAISE EXCEPTION 'A player in this match is already playing'; END IF;

  UPDATE public.team_duel_matches
  SET status = 'playing', court_number = p_court_number,
      revision = revision + 1, updated_at = now()
  WHERE id = p_match_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_team_duel_match_to_queue_atomic(
  p_match_id uuid,
  p_expected_revision integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.team_duel_matches
  SET status = 'available', court_number = NULL,
      revision = revision + 1, updated_at = now()
  WHERE id = p_match_id AND status = 'playing' AND revision = p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Playing match changed on another device';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_team_duel_result_atomic(
  p_match_id uuid,
  p_team_a_score integer,
  p_team_b_score integer,
  p_expected_revision integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_match public.team_duel_matches%ROWTYPE;
  v_event public.team_duel_events%ROWTYPE;
  v_standard_total integer;
  v_standard_completed integer;
  v_a_wins integer;
  v_b_wins integer;
BEGIN
  SELECT * INTO v_match FROM public.team_duel_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team Duel match not found'; END IF;
  SELECT * INTO v_event FROM public.team_duel_events WHERE id = v_match.event_id FOR UPDATE;
  IF v_event.status NOT IN ('active', 'tiebreak_required') THEN
    RAISE EXCEPTION 'This Team Duel is not live';
  END IF;
  IF v_match.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Team Duel match changed on another device';
  END IF;
  IF v_match.status <> 'playing' THEN RAISE EXCEPTION 'Start this match before recording its score'; END IF;
  IF p_team_a_score < 0 OR p_team_b_score < 0 OR p_team_a_score = p_team_b_score
    OR greatest(p_team_a_score, p_team_b_score) < 11
    OR abs(p_team_a_score - p_team_b_score) < 2
  THEN RAISE EXCEPTION 'A standard game requires at least 11 points and a 2-point winning margin'; END IF;

  UPDATE public.team_duel_matches
  SET status = 'completed', court_number = NULL,
      team_a_score = p_team_a_score, team_b_score = p_team_b_score,
      result_recorded_at = now(), revision = revision + 1, updated_at = now()
  WHERE id = p_match_id;

  IF v_match.kind = 'tiebreak' THEN
    UPDATE public.team_duel_events
    SET status = 'completed', completed_at = now(),
        revision = revision + 1, updated_at = now()
    WHERE id = v_match.event_id;
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'completed'),
         count(*) FILTER (WHERE status = 'completed' AND team_a_score > team_b_score),
         count(*) FILTER (WHERE status = 'completed' AND team_b_score > team_a_score)
  INTO v_standard_total, v_standard_completed, v_a_wins, v_b_wins
  FROM public.team_duel_matches
  WHERE event_id = v_match.event_id AND kind = 'standard';

  IF v_standard_completed = v_standard_total THEN
    IF v_a_wins = v_b_wins THEN
      UPDATE public.team_duel_events
      SET status = 'tiebreak_required', revision = revision + 1, updated_at = now()
      WHERE id = v_match.event_id;
    ELSE
      UPDATE public.team_duel_events
      SET status = 'completed', completed_at = now(),
          revision = revision + 1, updated_at = now()
      WHERE id = v_match.event_id;
    END IF;
  ELSE
    UPDATE public.team_duel_events
    SET revision = revision + 1, updated_at = now()
    WHERE id = v_match.event_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team_duel_tiebreak_atomic(
  p_event_id uuid,
  p_team_a_rank_1 integer,
  p_team_a_rank_2 integer,
  p_team_b_rank_1 integer,
  p_team_b_rank_2 integer,
  p_expected_revision integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event public.team_duel_events%ROWTYPE;
  v_match_id uuid := gen_random_uuid();
  v_standard_total integer;
  v_a_wins integer;
  v_b_wins integer;
BEGIN
  SELECT * INTO v_event FROM public.team_duel_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team Duel not found'; END IF;
  IF v_event.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Team Duel changed on another device';
  END IF;
  IF v_event.status <> 'tiebreak_required' THEN RAISE EXCEPTION 'This duel does not require a tiebreak'; END IF;
  IF p_team_a_rank_1 = p_team_a_rank_2 OR p_team_b_rank_1 = p_team_b_rank_2
    OR p_team_a_rank_1 NOT BETWEEN 1 AND v_event.roster_size
    OR p_team_a_rank_2 NOT BETWEEN 1 AND v_event.roster_size
    OR p_team_b_rank_1 NOT BETWEEN 1 AND v_event.roster_size
    OR p_team_b_rank_2 NOT BETWEEN 1 AND v_event.roster_size
  THEN RAISE EXCEPTION 'Choose two distinct valid players for each tiebreak side'; END IF;
  IF EXISTS (SELECT 1 FROM public.team_duel_matches WHERE event_id = p_event_id AND kind = 'tiebreak') THEN
    RAISE EXCEPTION 'This duel already has a tiebreak match';
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE team_a_score > team_b_score),
         count(*) FILTER (WHERE team_b_score > team_a_score)
  INTO v_standard_total, v_a_wins, v_b_wins
  FROM public.team_duel_matches
  WHERE event_id = p_event_id AND kind = 'standard' AND status = 'completed';
  IF v_standard_total <> v_event.roster_size * (v_event.roster_size - 1) / 2
    OR v_a_wins <> v_b_wins
  THEN RAISE EXCEPTION 'The completed standard schedule is not tied'; END IF;

  INSERT INTO public.team_duel_matches (
    id, event_id, kind, round_number, sequence_number,
    team_a_rank_1, team_a_rank_2, team_b_rank_1, team_b_rank_2
  ) VALUES (
    v_match_id, p_event_id, 'tiebreak',
    CASE WHEN v_event.roster_size % 2 = 0 THEN v_event.roster_size ELSE v_event.roster_size + 1 END,
    v_standard_total + 1,
    p_team_a_rank_1, p_team_a_rank_2, p_team_b_rank_1, p_team_b_rank_2
  );
  UPDATE public.team_duel_events
  SET revision = revision + 1, updated_at = now()
  WHERE id = p_event_id;
  RETURN v_match_id;
END;
$$;

ALTER TABLE public.team_duel_squads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_duel_squad_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_duel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_duel_event_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_duel_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin access team duel squads"
  ON public.team_duel_squads FOR ALL TO authenticated
  USING ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
  WITH CHECK ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
CREATE POLICY "Admin access team duel squad members"
  ON public.team_duel_squad_members FOR ALL TO authenticated
  USING ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
  WITH CHECK ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

CREATE POLICY "Public read visible team duel events"
  ON public.team_duel_events FOR SELECT TO anon, authenticated
  USING (status <> 'draft');
CREATE POLICY "Admin access team duel events"
  ON public.team_duel_events FOR ALL TO authenticated
  USING ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
  WITH CHECK ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

CREATE POLICY "Public read visible team duel event players"
  ON public.team_duel_event_players FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_duel_events AS event
    WHERE event.id = event_id AND event.status <> 'draft'
  ));
CREATE POLICY "Admin access team duel event players"
  ON public.team_duel_event_players FOR ALL TO authenticated
  USING ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
  WITH CHECK ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

CREATE POLICY "Public read visible team duel matches"
  ON public.team_duel_matches FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_duel_events AS event
    WHERE event.id = event_id AND event.status <> 'draft'
  ));
CREATE POLICY "Admin access team duel matches"
  ON public.team_duel_matches FOR ALL TO authenticated
  USING ((select auth.jwt()->'app_metadata'->>'role') = 'admin')
  WITH CHECK ((select auth.jwt()->'app_metadata'->>'role') = 'admin');

REVOKE ALL ON public.team_duel_squads, public.team_duel_squad_members,
  public.team_duel_events, public.team_duel_event_players, public.team_duel_matches
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.team_duel_squads, public.team_duel_squad_members,
     public.team_duel_events, public.team_duel_event_players, public.team_duel_matches
  TO authenticated;
GRANT SELECT ON public.team_duel_events, public.team_duel_event_players,
  public.team_duel_matches TO anon;

REVOKE ALL ON FUNCTION public.check_team_duel_squad_roster() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_team_duel_event_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_team_duel_event_player_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_team_duel_match_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_team_duel_squad_atomic(uuid, text, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_team_duel_squad_archived_atomic(uuid, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_team_duel_draft_atomic(uuid, date, text, uuid, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_team_duel_draft_atomic(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_team_duel_event_atomic(uuid, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_team_duel_match_atomic(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.return_team_duel_match_to_queue_atomic(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_team_duel_result_atomic(uuid, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_team_duel_tiebreak_atomic(uuid, integer, integer, integer, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_team_duel_squad_atomic(uuid, text, uuid[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_team_duel_squad_archived_atomic(uuid, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_duel_draft_atomic(uuid, date, text, uuid, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_team_duel_draft_atomic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_team_duel_event_atomic(uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_team_duel_match_atomic(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_team_duel_match_to_queue_atomic(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_duel_result_atomic(uuid, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_duel_tiebreak_atomic(uuid, integer, integer, integer, integer, integer) TO authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'team_duel_squads', 'team_duel_squad_members', 'team_duel_events',
    'team_duel_event_players', 'team_duel_matches'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;
