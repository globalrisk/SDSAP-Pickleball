-- Enforce the optional four-player rating spread on draft saves and generation.
-- Historical fixture validation does not re-rate already generated matches.
CREATE OR REPLACE FUNCTION public.validate_flexible_duel_plan(p_season_id uuid, p_plan jsonb, p_check_ratings boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; roster uuid[]; ids uuid[]; home_ids uuid[]; away_ids uuid[]; all_ids uuid[]; size integer;
  games jsonb; game jsonb; fixture_count integer; rounds integer; partner_cap integer; opponent_cap integer;
  ordered uuid[]; h uuid[]; a uuid[]; i integer := 0; k integer; p double precision; delta double precision; variance double precision;
  max_probability double precision; max_rating_difference numeric; rating_spread double precision;
  distribution double precision[]; home_chance double precision := 0; away_chance double precision := 0;
BEGIN
  SELECT league_id INTO league FROM public.seasons WHERE id = p_season_id;
  SELECT array_agg(pool_player_id ORDER BY pool_player_id) INTO roster FROM public.season_roster WHERE season_id = p_season_id;
  size := cardinality(roster) / 2; fixture_count := size*(size-1)/2; rounds := size-1+size%2;
  IF size IS NULL OR cardinality(roster) NOT IN (8,10,12,14) OR p_plan IS NULL OR (p_plan->>'version')::integer IS DISTINCT FROM 1
    OR jsonb_typeof(p_plan->'squads') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'squads') <> 2
    OR jsonb_typeof(p_plan->'settings') IS DISTINCT FROM 'object'
    OR NOT (p_plan->'settings' ?& ARRAY['maxPartnerMeetings','maxOpponentMeetings']) THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Invalid roster, planner version, or settings' USING ERRCODE='23514';
  END IF;
  IF p_plan->'settings' ? 'maxMatchProbability' AND jsonb_typeof(p_plan->'settings'->'maxMatchProbability') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'DUEL_MATCH_LIMIT_RANGE: Match probability must be between 50%% and 100%%' USING ERRCODE='23514';
  END IF;
  max_probability := COALESCE((p_plan->'settings'->>'maxMatchProbability')::double precision,0.65);
  IF max_probability NOT BETWEEN 0.5 AND 1.0 OR max_probability::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'DUEL_MATCH_LIMIT_RANGE: Match probability must be between 50%% and 100%%' USING ERRCODE='23514';
  END IF;
  IF p_plan->'settings' ? 'maxRatingDifference' AND p_plan->'settings'->'maxRatingDifference' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_plan->'settings'->'maxRatingDifference') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'DUEL_RATING_LIMIT_RANGE: Ranking-point difference must be a nonnegative whole number or No limit' USING ERRCODE='23514';
    END IF;
    max_rating_difference := (p_plan->'settings'->>'maxRatingDifference')::numeric;
    IF max_rating_difference < 0 OR max_rating_difference <> trunc(max_rating_difference) OR max_rating_difference::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'DUEL_RATING_LIMIT_RANGE: Ranking-point difference must be a nonnegative whole number or No limit' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT array_agg(value::uuid ORDER BY ordinality) INTO home_ids FROM jsonb_array_elements_text(p_plan->'squads'->0) WITH ORDINALITY;
  SELECT array_agg(value::uuid ORDER BY ordinality) INTO away_ids FROM jsonb_array_elements_text(p_plan->'squads'->1) WITH ORDINALITY;
  all_ids := home_ids || away_ids;
  IF cardinality(home_ids) IS DISTINCT FROM size OR cardinality(away_ids) IS DISTINCT FROM size
    OR (SELECT count(DISTINCT id) FROM unnest(all_ids) id) <> size*2
    OR (SELECT array_agg(id ORDER BY id) FROM unnest(all_ids) id) IS DISTINCT FROM roster THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Squads must cover the roster exactly once' USING ERRCODE='23514';
  END IF;
  partner_cap := COALESCE((p_plan->'settings'->>'maxPartnerMeetings')::integer,size-1);
  opponent_cap := COALESCE((p_plan->'settings'->>'maxOpponentMeetings')::integer,size-1);
  IF partner_cap NOT BETWEEN 1 AND size-1 OR opponent_cap NOT BETWEEN 1 AND size-1 OR opponent_cap*size < 2*(size-1) THEN
    RAISE EXCEPTION 'DUEL_INVALID_LIMIT: Invalid or impossible repeat limits' USING ERRCODE='23514';
  END IF;
  games := p_plan->'option'->'games';
  IF jsonb_typeof(games) IS DISTINCT FROM 'array' OR jsonb_array_length(games) <> fixture_count THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: A complete fixture list is required' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(games) g WHERE
    jsonb_typeof(g->'homePoolPlayerIds') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'homePoolPlayerIds') <> 2
    OR jsonb_typeof(g->'awayPoolPlayerIds') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'awayPoolPlayerIds') <> 2
    OR (g->>'roundNumber')::integer IS NULL OR (g->>'roundNumber')::integer NOT BETWEEN 1 AND rounds
    OR (g->>'sequenceNumber')::integer IS NULL OR (g->>'sequenceNumber')::integer NOT BETWEEN 1 AND fixture_count)
    OR (SELECT count(DISTINCT (g->>'sequenceNumber')::integer) FROM jsonb_array_elements(games) g) <> fixture_count
    OR (SELECT count(DISTINCT (g->>'roundNumber')::integer) FROM jsonb_array_elements(games) g) <> rounds
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(games) g GROUP BY g->>'roundNumber' HAVING count(*) <> size/2) THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Invalid rounds or sequence numbers' USING ERRCODE='23514';
  END IF;
  FOR game IN SELECT value FROM jsonb_array_elements(games) LOOP
    SELECT array_agg(value::uuid) INTO h FROM jsonb_array_elements_text(game->'homePoolPlayerIds');
    SELECT array_agg(value::uuid) INTO a FROM jsonb_array_elements_text(game->'awayPoolPlayerIds');
    IF NOT h <@ home_ids OR NOT a <@ away_ids OR (SELECT count(DISTINCT id) FROM unnest(h||a) id) <> 4 THEN
      RAISE EXCEPTION 'DUEL_INVALID_PLAN: Four distinct squad participants are required' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(games) g CROSS JOIN LATERAL jsonb_array_elements_text((g->'homePoolPlayerIds') || (g->'awayPoolPlayerIds')) player
    GROUP BY g->>'roundNumber',player.value HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM unnest(all_ids) player(id) WHERE (SELECT count(*) FROM jsonb_array_elements(games) g
      WHERE (g->'homePoolPlayerIds') ? player.id::text OR (g->'awayPoolPlayerIds') ? player.id::text) <> size-1
  ) THEN RAISE EXCEPTION 'DUEL_INVALID_PLAN: Unequal participation or double booking' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(games) g CROSS JOIN LATERAL (VALUES(g->'homePoolPlayerIds'),(g->'awayPoolPlayerIds')) side(ids)
    GROUP BY LEAST(side.ids->>0,side.ids->>1),GREATEST(side.ids->>0,side.ids->>1) HAVING count(*) > partner_cap
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(games) g CROSS JOIN LATERAL jsonb_array_elements_text(g->'homePoolPlayerIds') h
      CROSS JOIN LATERAL jsonb_array_elements_text(g->'awayPoolPlayerIds') a GROUP BY h.value,a.value HAVING count(*) > opponent_cap
  ) THEN RAISE EXCEPTION 'DUEL_REPEAT_LIMIT: Repeat limits exceeded' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(games) g
    GROUP BY ARRAY(SELECT value::uuid FROM jsonb_array_elements_text((g->'homePoolPlayerIds') || (g->'awayPoolPlayerIds')) ORDER BY value::uuid)
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'DUEL_DUPLICATE_MATCH: The same four players can play together only once per season' USING ERRCODE='23514'; END IF;
  IF NOT p_check_ratings THEN RETURN; END IF;
  IF p_plan->>'engine' IS DISTINCT FROM 'cp-sat' OR p_plan->'option'->>'kind' IS NULL OR p_plan->'option'->>'kind' NOT IN ('balance','variety') THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: Run a fresh schedule search before saving or generating' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(all_ids) player(id) LEFT JOIN public.league_players lp ON lp.league_id=league AND lp.pool_player_id=player.id
    WHERE lp.status IS DISTINCT FROM 'active' OR lp.rating::text IN ('NaN','Infinity','-Infinity')
      OR lp.rating_deviation < 0 OR lp.rating_deviation::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Active rated players are required' USING ERRCODE='23514';
  END IF;
  FOREACH ids SLICE 1 IN ARRAY ARRAY[home_ids,away_ids] LOOP
    SELECT array_agg(pool_player_id ORDER BY rating DESC,pool_player_id) INTO ordered FROM public.league_players WHERE league_id=league AND pool_player_id=ANY(ids);
    IF ids IS DISTINCT FROM ordered THEN RAISE EXCEPTION 'DUEL_STALE_DRAFT: Squad ranks changed' USING ERRCODE='40001'; END IF;
  END LOOP;
  distribution := array_fill(0.0::double precision, ARRAY[fixture_count+1], ARRAY[0]); distribution[0] := 1;
  FOR game IN SELECT value FROM jsonb_array_elements(games) ORDER BY (value->>'sequenceNumber')::integer LOOP
    SELECT sum(CASE WHEN (game->'homePoolPlayerIds') ? lp.pool_player_id::text THEN lp.rating ELSE -lp.rating END), sum(lp.rating_deviation*lp.rating_deviation), max(lp.rating)-min(lp.rating)
      INTO delta,variance,rating_spread FROM public.league_players lp WHERE lp.league_id=league AND
        ((game->'homePoolPlayerIds') ? lp.pool_player_id::text OR (game->'awayPoolPlayerIds') ? lp.pool_player_id::text);
    IF max_rating_difference IS NOT NULL AND rating_spread > max_rating_difference THEN
      RAISE EXCEPTION 'DUEL_RATING_DIFFERENCE: Match % exceeds the chosen ranking-point difference limit of %', i+1, max_rating_difference USING ERRCODE='23514';
    END IF;
    p := public.duel_standard_normal_cdf(delta / sqrt(250000.0+variance)); i := i+1;
    IF GREATEST(p,1-p) > max_probability+1e-12 THEN
      RAISE EXCEPTION 'DUEL_MATCH_BALANCE: Match % exceeds the chosen % percent win probability limit', i, max_probability*100 USING ERRCODE='23514';
    END IF;
    FOR k IN REVERSE i..0 LOOP
      distribution[k] := distribution[k]*(1-p) + CASE WHEN k>0 THEN distribution[k-1]*p ELSE 0 END;
    END LOOP;
  END LOOP;
  FOR k IN 0..fixture_count LOOP
    IF 2*k>fixture_count THEN home_chance:=home_chance+distribution[k];
    ELSIF 2*k<fixture_count THEN away_chance:=away_chance+distribution[k]; END IF;
  END LOOP;
  IF GREATEST(home_chance,away_chance)/(home_chance+away_chance) > 0.55+1e-12 THEN
    RAISE EXCEPTION 'DUEL_SEASON_BALANCE: Season favorite exceeds 55%%' USING ERRCODE='23514';
  END IF;
END;
$$;
