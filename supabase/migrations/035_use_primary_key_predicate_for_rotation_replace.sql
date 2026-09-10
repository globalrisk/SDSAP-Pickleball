-- safeupdate evaluates anonymous Data API calls more strictly. The primary key
-- is non-null, so this still targets the singleton row while satisfying it.

CREATE OR REPLACE FUNCTION public.replace_rotation_event_atomic(
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

  DELETE FROM public.rotation_events WHERE id IS NOT NULL;
  INSERT INTO public.rotation_events (
    id, name, matches_per_player, court_count, schedule_seed, status
  ) VALUES (
    p_event_id, btrim(p_name), p_matches_per_player, p_court_count, p_schedule_seed, 'draft'
  );

  INSERT INTO public.rotation_players (id, event_id, name, display_order)
  SELECT
    (item->>'id')::uuid,
    p_event_id,
    btrim(item->>'name'),
    (item->>'display_order')::integer
  FROM jsonb_array_elements(p_players) AS item;

  INSERT INTO public.rotation_matches (
    id, event_id, sequence_number,
    team_a_player_1_id, team_a_player_2_id,
    team_b_player_1_id, team_b_player_2_id
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
      SELECT team_a_player_1_id AS player_id FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_a_player_2_id FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_b_player_1_id FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL SELECT team_b_player_2_id FROM public.rotation_matches WHERE event_id = p_event_id
    ), counts AS (
      SELECT player_id, count(*) AS played FROM appearances GROUP BY player_id
    )
    SELECT 1
    FROM public.rotation_players player
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
      FROM public.rotation_matches WHERE event_id = p_event_id
      UNION ALL
      SELECT
        least(team_b_player_1_id, team_b_player_2_id),
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
