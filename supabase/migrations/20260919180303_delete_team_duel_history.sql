CREATE OR REPLACE FUNCTION public.protect_team_duel_event_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'completed'
      AND current_setting('app.team_duel_history_delete', true) = 'on'
    THEN
      RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION public.protect_team_duel_event_player_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('app.team_duel_history_delete', true) = 'on'
  THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION public.protect_team_duel_match_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.team_duel_history_delete', true) = 'on' THEN
      RETURN OLD;
    END IF;
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

CREATE OR REPLACE FUNCTION public.delete_team_duel_history_atomic(
  p_event_id uuid,
  p_expected_revision integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event public.team_duel_events%ROWTYPE;
BEGIN
  IF coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrator access is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('team-duel-history-delete:' || p_event_id::text, 0)
  );

  SELECT *
  INTO v_event
  FROM public.team_duel_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_event.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed Team Duel history can be deleted';
  END IF;
  IF v_event.revision <> p_expected_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Duel history changed on another device';
  END IF;

  PERFORM set_config('app.team_duel_history_delete', 'on', true);
  DELETE FROM public.team_duel_matches WHERE event_id = p_event_id;
  DELETE FROM public.team_duel_event_players WHERE event_id = p_event_id;
  DELETE FROM public.team_duel_events
  WHERE id = p_event_id
    AND status = 'completed'
    AND revision = p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Duel history changed on another device';
  END IF;
  PERFORM set_config('app.team_duel_history_delete', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_team_duel_history_atomic(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_team_duel_history_atomic(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_team_duel_history_atomic(uuid, integer) TO authenticated;
