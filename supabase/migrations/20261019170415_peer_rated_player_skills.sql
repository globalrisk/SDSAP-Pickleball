-- Peer opinions belong to shared player identities, never to a season or league.
-- Only aggregate scores and the caller's own submission leave this schema.
CREATE SCHEMA player_skills_private;
REVOKE ALL ON SCHEMA player_skills_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA player_skills_private TO anon, authenticated;

CREATE TABLE player_skills_private.ratings (
  rater_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE CASCADE,
  drive smallint CHECK (drive BETWEEN 0 AND 100),
  drop smallint CHECK (drop BETWEEN 0 AND 100),
  serve smallint CHECK (serve BETWEEN 0 AND 100),
  dink smallint CHECK (dink BETWEEN 0 AND 100),
  return smallint CHECK (return BETWEEN 0 AND 100),
  volley smallint CHECK (volley BETWEEN 0 AND 100),
  lob smallint CHECK (lob BETWEEN 0 AND 100),
  footwork smallint CHECK (footwork BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rater_id, target_id),
  CHECK (rater_id <> target_id),
  CHECK (coalesce(drive, drop, serve, dink, return, volley, lob, footwork) IS NOT NULL)
);
CREATE INDEX player_skill_ratings_target_idx ON player_skills_private.ratings(target_id);
ALTER TABLE player_skills_private.ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_skills_private.ratings FROM PUBLIC, anon, authenticated;

CREATE FUNCTION player_skills_private.summary(p_player_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE skills jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.player_pool WHERE id = p_player_id) THEN
    RAISE EXCEPTION 'SKILL_PLAYER: Player not found';
  END IF;
  SELECT jsonb_object_agg(skill, jsonb_build_object('average', average, 'count', votes)) INTO skills
  FROM (
    SELECT k.skill, round(avg((to_jsonb(r)->>k.skill)::numeric))::integer AS average,
      count(to_jsonb(r)->>k.skill) AS votes
    FROM unnest(ARRAY['drive','drop','serve','dink','return','volley','lob','footwork']) AS k(skill)
    LEFT JOIN player_skills_private.ratings r ON r.target_id = p_player_id
    GROUP BY k.skill
  ) AS averages;
  RETURN jsonb_build_object('skills', skills, 'raterCount',
    (SELECT count(*) FROM player_skills_private.ratings WHERE target_id = p_player_id));
END $$;

CREATE FUNCTION player_skills_private.my_rating(p_league_id uuid, p_player_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rater uuid; scores jsonb; reason text := 'eligible';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SKILL_AUTH: Sign in required' USING ERRCODE = '42501'; END IF;
  SELECT pool_player_id INTO rater FROM public.player_accounts WHERE user_id = auth.uid();
  SELECT jsonb_build_object('drive', drive, 'drop', drop, 'serve', serve, 'dink', dink,
    'return', return, 'volley', volley, 'lob', lob, 'footwork', footwork)
    INTO scores FROM player_skills_private.ratings WHERE rater_id = rater AND target_id = p_player_id;
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

CREATE FUNCTION player_skills_private.save_rating(p_league_id uuid, p_player_id uuid, p_scores jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rater uuid; context jsonb; entry record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SKILL_AUTH: Sign in required' USING ERRCODE = '42501'; END IF;
  -- Same lock as link/unlink: neither party's ownership can change during a vote.
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
    IF entry.key <> ALL(ARRAY['drive','drop','serve','dink','return','volley','lob','footwork']) THEN
      RAISE EXCEPTION 'SKILL_SCORES: Unknown skill';
    END IF;
    IF entry.value = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(entry.value) <> 'number' THEN RAISE EXCEPTION 'SKILL_SCORES: Scores must be numbers'; END IF;
    IF entry.value::numeric < 0 OR entry.value::numeric > 100 OR trunc(entry.value::numeric) <> entry.value::numeric THEN
      RAISE EXCEPTION 'SKILL_SCORES: Scores must be whole numbers from 0 to 100';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM jsonb_each(p_scores) WHERE value <> 'null'::jsonb) THEN
    RAISE EXCEPTION 'SKILL_SCORES: Rate at least one skill';
  END IF;
  INSERT INTO player_skills_private.ratings(rater_id, target_id, drive, drop, serve, dink, return, volley, lob, footwork)
  VALUES (rater, p_player_id, (p_scores->>'drive')::numeric::smallint, (p_scores->>'drop')::numeric::smallint,
    (p_scores->>'serve')::numeric::smallint, (p_scores->>'dink')::numeric::smallint, (p_scores->>'return')::numeric::smallint,
    (p_scores->>'volley')::numeric::smallint, (p_scores->>'lob')::numeric::smallint, (p_scores->>'footwork')::numeric::smallint)
  ON CONFLICT (rater_id, target_id) DO UPDATE SET drive = EXCLUDED.drive, drop = EXCLUDED.drop,
    serve = EXCLUDED.serve, dink = EXCLUDED.dink, return = EXCLUDED.return, volley = EXCLUDED.volley,
    lob = EXCLUDED.lob, footwork = EXCLUDED.footwork, updated_at = now();
END $$;

CREATE FUNCTION player_skills_private.remove_rating(p_player_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rater uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SKILL_AUTH: Sign in required' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_player_account_links', 0));
  SELECT pool_player_id INTO rater FROM public.player_accounts WHERE user_id = auth.uid();
  IF rater IS NULL THEN RAISE EXCEPTION 'SKILL_AUTH: Linked account required' USING ERRCODE = '42501'; END IF;
  -- Withdrawal stays available even if membership or target eligibility changed.
  DELETE FROM player_skills_private.ratings WHERE rater_id = rater AND target_id = p_player_id;
END $$;

-- Invoker wrappers expose only the four controlled interfaces to PostgREST.
CREATE FUNCTION public.player_skill_summary(p_player_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT player_skills_private.summary(p_player_id) $$;
CREATE FUNCTION public.my_player_skill_rating(p_league_id uuid, p_player_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT player_skills_private.my_rating(p_league_id, p_player_id) $$;
CREATE FUNCTION public.save_player_skill_rating(p_league_id uuid, p_player_id uuid, p_scores jsonb) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT player_skills_private.save_rating(p_league_id, p_player_id, p_scores) $$;
CREATE FUNCTION public.remove_player_skill_rating(p_player_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT player_skills_private.remove_rating(p_player_id) $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA player_skills_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.player_skill_summary(uuid), public.my_player_skill_rating(uuid,uuid),
  public.save_player_skill_rating(uuid,uuid,jsonb), public.remove_player_skill_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION player_skills_private.summary(uuid), public.player_skill_summary(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION player_skills_private.my_rating(uuid,uuid), player_skills_private.save_rating(uuid,uuid,jsonb),
  player_skills_private.remove_rating(uuid), public.my_player_skill_rating(uuid,uuid),
  public.save_player_skill_rating(uuid,uuid,jsonb), public.remove_player_skill_rating(uuid) TO authenticated;
