-- Prevent a slower client from committing a rating rebuild based on stale data.
-- Public data access remains unchanged; this only adds optimistic concurrency.

CREATE TABLE IF NOT EXISTS public.rating_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

INSERT INTO public.rating_state (id, revision)
VALUES (true, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.rating_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read rating_state" ON public.rating_state;
DROP POLICY IF EXISTS "Public write rating_state" ON public.rating_state;
CREATE POLICY "Public read rating_state" ON public.rating_state FOR SELECT USING (true);

DROP FUNCTION IF EXISTS public.save_match_and_ratings_atomic(
  uuid, text, uuid, integer, integer, uuid[], uuid[], timestamptz, jsonb, jsonb
);
DROP FUNCTION IF EXISTS public.replace_ratings_atomic(jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.claim_rating_revision(p_expected_revision bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_revision bigint;
  next_revision bigint;
BEGIN
  SELECT revision INTO current_revision
  FROM public.rating_state
  WHERE id = true
  FOR UPDATE;

  IF current_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Rating revision conflict: expected %, current %',
      p_expected_revision, current_revision
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.rating_state
  SET revision = revision + 1
  WHERE id = true
  RETURNING revision INTO next_revision;
  RETURN next_revision;
END;
$$;

CREATE FUNCTION public.replace_ratings_atomic(
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

  PERFORM pg_advisory_xact_lock(hashtext('sdsap_replace_ratings'));
  next_revision := public.claim_rating_revision(p_expected_revision);

  DELETE FROM public.rating_history WHERE id IS NOT NULL;

  INSERT INTO public.rating_history (
    pool_player_id, match_id, rating, rating_deviation, sequence, recorded_at
  )
  SELECT
    row.pool_player_id, row.match_id, row.rating,
    row.rating_deviation, row.sequence, row.recorded_at
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

  RETURN next_revision;
END;
$$;

CREATE FUNCTION public.save_match_and_ratings_atomic(
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
  PERFORM pg_advisory_xact_lock(hashtext('sdsap_replace_ratings'));
  claimed_revision := public.claim_rating_revision(p_expected_revision);

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

  PERFORM public.replace_ratings_atomic(
    p_history_rows, p_player_ratings, claimed_revision
  );
END;
$$;

REVOKE ALL ON public.rating_state FROM anon, authenticated;
GRANT SELECT ON public.rating_state TO anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_rating_revision(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_rating_revision(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_ratings_atomic(jsonb, jsonb, bigint)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_match_and_ratings_atomic(
  uuid, text, uuid, integer, integer, uuid[], uuid[], timestamptz, jsonb, jsonb, bigint
) TO anon, authenticated;
