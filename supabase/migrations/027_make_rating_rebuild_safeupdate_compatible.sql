-- Keep the full derived-rating rebuild compatible with Supabase's safeupdate guard.

CREATE OR REPLACE FUNCTION public.replace_ratings_atomic(
  p_history_rows jsonb,
  p_player_ratings jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  history_count integer;
  rating_count integer;
  updated_count integer;
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

  -- Serialize rebuilds so two clients cannot replace derived data concurrently.
  PERFORM pg_advisory_xact_lock(hashtext('sdsap_replace_ratings'));

  -- rating_history.id is a non-null primary key, so this intentionally replaces
  -- every derived row while satisfying the safeupdate WHERE requirement.
  DELETE FROM public.rating_history
  WHERE id IS NOT NULL;

  INSERT INTO public.rating_history (
    pool_player_id,
    match_id,
    rating,
    rating_deviation,
    sequence,
    recorded_at
  )
  SELECT
    row.pool_player_id,
    row.match_id,
    row.rating,
    row.rating_deviation,
    row.sequence,
    row.recorded_at
  FROM jsonb_to_recordset(p_history_rows) AS row(
    pool_player_id uuid,
    match_id uuid,
    rating double precision,
    rating_deviation double precision,
    sequence integer,
    recorded_at timestamptz
  );

  UPDATE public.player_pool AS player
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
  WHERE player.id = replacement.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> rating_count THEN
    RAISE EXCEPTION 'Expected to update % players, updated %', rating_count, updated_count;
  END IF;
END;
$$;
