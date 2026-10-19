-- Add attributes without rewriting the original scores or changing account rules.
ALTER TABLE player_skills_private.ratings
  ADD COLUMN reset smallint CHECK (reset BETWEEN 0 AND 100),
  ADD COLUMN overhead smallint CHECK (overhead BETWEEN 0 AND 100),
  ADD COLUMN hand_speed smallint CHECK (hand_speed BETWEEN 0 AND 100),
  ADD COLUMN stamina smallint CHECK (stamina BETWEEN 0 AND 100),
  ADD COLUMN positioning smallint CHECK (positioning BETWEEN 0 AND 100),
  ADD COLUMN shot_selection smallint CHECK (shot_selection BETWEEN 0 AND 100),
  ADD COLUMN game_iq smallint CHECK (game_iq BETWEEN 0 AND 100),
  ADD COLUMN mental_game smallint CHECK (mental_game BETWEEN 0 AND 100),
  ADD COLUMN teamwork smallint CHECK (teamwork BETWEEN 0 AND 100),
  ADD COLUMN consistency smallint CHECK (consistency BETWEEN 0 AND 100);

-- The original check was automatically named; locate it by its definition.
DO $$ DECLARE original_check text; BEGIN
  SELECT conname INTO STRICT original_check FROM pg_catalog.pg_constraint
  WHERE conrelid = 'player_skills_private.ratings'::regclass AND contype = 'c'
    AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%coalesce(%';
  EXECUTE format('ALTER TABLE player_skills_private.ratings DROP CONSTRAINT %I', original_check);
END $$;
ALTER TABLE player_skills_private.ratings ADD CONSTRAINT ratings_observed_score_check
  CHECK (coalesce(drive, drop, serve, dink, return, volley, lob, footwork, reset, overhead,
    hand_speed, stamina, positioning, shot_selection, game_iq, mental_game, teamwork, consistency) IS NOT NULL);

CREATE FUNCTION player_skills_private.score_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT ARRAY['drive','drop','serve','dink','return','volley','lob','reset','overhead',
    'footwork','hand_speed','stamina','positioning','shot_selection','game_iq','mental_game','teamwork','consistency']::text[]
$$;
REVOKE ALL ON FUNCTION player_skills_private.score_keys() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION player_skills_private.summary(p_player_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE skills jsonb; totals jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.player_pool WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'SKILL_PLAYER: Player not found';
  END IF;
  SELECT jsonb_object_agg(skill, jsonb_build_object('average', average, 'count', votes)) INTO skills
  FROM (
    SELECT k.skill, round(avg((to_jsonb(r)->>k.skill)::numeric))::integer AS average,
      count(to_jsonb(r)->>k.skill) AS votes
    FROM unnest(player_skills_private.score_keys()) AS k(skill)
    LEFT JOIN player_skills_private.ratings r ON r.target_id = p_player_id
    GROUP BY k.skill
  ) AS averages;
  SELECT jsonb_build_object('raterCount', count(*), 'groupRaterCounts', jsonb_build_object(
    'shots', count(*) FILTER (WHERE coalesce(drive, drop, serve, dink, return, volley, lob, reset, overhead) IS NOT NULL),
    'attributes', count(*) FILTER (WHERE coalesce(footwork, hand_speed, stamina, positioning,
      shot_selection, game_iq, mental_game, teamwork, consistency) IS NOT NULL)))
  INTO totals FROM player_skills_private.ratings WHERE target_id = p_player_id;
  RETURN totals || jsonb_build_object('skills', skills);
END $$;

CREATE OR REPLACE FUNCTION player_skills_private.my_rating(p_league_id uuid, p_player_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rater uuid; scores jsonb; reason text := 'eligible';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SKILL_AUTH: Sign in required' USING ERRCODE = '42501'; END IF;
  SELECT pool_player_id INTO rater FROM public.player_accounts WHERE user_id = auth.uid();
  SELECT (SELECT jsonb_object_agg(k.skill, to_jsonb(r)->k.skill)
    FROM unnest(player_skills_private.score_keys()) AS k(skill)) INTO scores
    FROM player_skills_private.ratings r WHERE r.rater_id = rater AND r.target_id = p_player_id;
  IF rater IS NULL THEN reason := 'unlinked';
  ELSIF rater = p_player_id THEN reason := 'self';
  ELSIF NOT EXISTS (SELECT 1 FROM public.player_accounts WHERE pool_player_id = p_player_id) THEN reason := 'target_unlinked';
  ELSIF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND status = 'active') THEN reason := 'league_inactive';
  ELSIF NOT EXISTS (SELECT 1 FROM public.league_players WHERE league_id = p_league_id AND pool_player_id = rater)
    OR NOT EXISTS (SELECT 1 FROM public.league_players WHERE league_id = p_league_id AND pool_player_id = p_player_id) THEN reason := 'not_member';
  ELSIF EXISTS (SELECT 1 FROM public.league_players WHERE league_id = p_league_id
    AND pool_player_id IN (rater, p_player_id) AND status <> 'active') THEN reason := 'inactive';
  END IF;
  RETURN jsonb_build_object('canRate', reason = 'eligible', 'reason', reason, 'scores', scores);
END $$;

CREATE OR REPLACE FUNCTION player_skills_private.save_rating(p_league_id uuid, p_player_id uuid, p_scores jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rater uuid; context jsonb; entry record; validated jsonb := '{}'; merged jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SKILL_AUTH: Sign in required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_player_account_links', 0));
  SELECT pool_player_id INTO rater FROM public.player_accounts WHERE user_id = auth.uid();
  PERFORM 1 FROM public.leagues WHERE id = p_league_id FOR SHARE;
  PERFORM 1 FROM public.league_players WHERE league_id = p_league_id
    AND pool_player_id IN (rater, p_player_id) ORDER BY pool_player_id FOR SHARE;
  context := player_skills_private.my_rating(p_league_id, p_player_id);
  IF NOT (context->>'canRate')::boolean THEN
    RAISE EXCEPTION 'SKILL_INELIGIBLE: %', context->>'reason' USING ERRCODE = '42501';
  END IF;
  IF p_scores IS NULL OR jsonb_typeof(p_scores) <> 'object' THEN
    RAISE EXCEPTION 'SKILL_SCORES: Provide at least one whole-number score from 0 to 100';
  END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(p_scores) LOOP
    IF entry.key <> ALL(player_skills_private.score_keys()) THEN RAISE EXCEPTION 'SKILL_SCORES: Unknown skill'; END IF;
    IF entry.value = 'null'::jsonb THEN
      validated := validated || jsonb_build_object(entry.key, NULL);
      CONTINUE;
    END IF;
    IF jsonb_typeof(entry.value) <> 'number' THEN RAISE EXCEPTION 'SKILL_SCORES: Scores must be numbers'; END IF;
    IF entry.value::numeric < 0 OR entry.value::numeric > 100 OR trunc(entry.value::numeric) <> entry.value::numeric THEN
      RAISE EXCEPTION 'SKILL_SCORES: Scores must be whole numbers from 0 to 100';
    END IF;
    validated := validated || jsonb_build_object(entry.key, entry.value::numeric::smallint);
  END LOOP;
  -- Old clients replace the original eight fields. Missing NEW fields preserve
  -- previous scores; current clients send all eighteen and clear with JSON null.
  merged := coalesce(nullif(context->'scores', 'null'::jsonb), '{}'::jsonb)
    || jsonb_build_object('drive',NULL,'drop',NULL,'serve',NULL,'dink',NULL,
      'return',NULL,'volley',NULL,'lob',NULL,'footwork',NULL) || validated;
  IF NOT EXISTS (SELECT 1 FROM jsonb_each(merged) WHERE value <> 'null'::jsonb) THEN
    RAISE EXCEPTION 'SKILL_SCORES: Rate at least one attribute';
  END IF;
  INSERT INTO player_skills_private.ratings(rater_id, target_id, drive, drop, serve, dink, return, volley,
    lob, footwork, reset, overhead, hand_speed, stamina, positioning, shot_selection, game_iq, mental_game, teamwork, consistency)
  SELECT rater, p_player_id, n.drive, n.drop, n.serve, n.dink, n.return, n.volley, n.lob, n.footwork,
    n.reset, n.overhead, n.hand_speed, n.stamina, n.positioning, n.shot_selection, n.game_iq, n.mental_game, n.teamwork, n.consistency
  FROM jsonb_populate_record(NULL::player_skills_private.ratings, merged) AS n
  ON CONFLICT (rater_id, target_id) DO UPDATE SET drive = EXCLUDED.drive, drop = EXCLUDED.drop,
    serve = EXCLUDED.serve, dink = EXCLUDED.dink, return = EXCLUDED.return, volley = EXCLUDED.volley,
    lob = EXCLUDED.lob, footwork = EXCLUDED.footwork, reset = EXCLUDED.reset, overhead = EXCLUDED.overhead,
    hand_speed = EXCLUDED.hand_speed, stamina = EXCLUDED.stamina, positioning = EXCLUDED.positioning,
    shot_selection = EXCLUDED.shot_selection, game_iq = EXCLUDED.game_iq, mental_game = EXCLUDED.mental_game,
    teamwork = EXCLUDED.teamwork, consistency = EXCLUDED.consistency, updated_at = now();
END $$;

-- Replacing private functions preserves their existing grants and fixed search
-- paths. The four public invoker wrappers and withdrawal rules remain unchanged.
