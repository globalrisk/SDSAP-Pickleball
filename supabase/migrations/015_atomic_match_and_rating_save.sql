-- Commit a match result change and its derived ratings as one transaction.

CREATE OR REPLACE FUNCTION public.save_match_and_ratings_atomic(
  p_match_id uuid,
  p_status text,
  p_winner_team_id uuid,
  p_home_score integer,
  p_away_score integer,
  p_home_pool_player_ids uuid[],
  p_away_pool_player_ids uuid[],
  p_result_recorded_at timestamptz,
  p_history_rows jsonb,
  p_player_ratings jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count integer;
BEGIN
  -- Use the same lock as replace_ratings_atomic to serialize all rebuilds.
  PERFORM pg_advisory_xact_lock(hashtext('sdsap_replace_ratings'));

  UPDATE public.matches
  SET
    status = p_status,
    winner_team_id = p_winner_team_id,
    home_score = p_home_score,
    away_score = p_away_score,
    home_pool_player_ids = p_home_pool_player_ids,
    away_pool_player_ids = p_away_pool_player_ids,
    result_recorded_at = p_result_recorded_at
  WHERE id = p_match_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Match % was not found', p_match_id;
  END IF;

  PERFORM public.replace_ratings_atomic(p_history_rows, p_player_ratings);
END;
$$;
