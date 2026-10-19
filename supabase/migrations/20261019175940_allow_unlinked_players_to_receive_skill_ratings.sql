-- Only the voter needs a linked account. Recipients must still be active in the same active league.
-- save_rating calls this check inside its existing account-link and membership locks.
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
  ELSIF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND status = 'active') THEN reason := 'league_inactive';
  ELSIF NOT EXISTS (SELECT 1 FROM public.league_players WHERE league_id = p_league_id AND pool_player_id = rater)
    OR NOT EXISTS (SELECT 1 FROM public.league_players WHERE league_id = p_league_id AND pool_player_id = p_player_id) THEN reason := 'not_member';
  ELSIF EXISTS (SELECT 1 FROM public.league_players WHERE league_id = p_league_id
    AND pool_player_id IN (rater, p_player_id) AND status <> 'active') THEN reason := 'inactive';
  END IF;
  RETURN jsonb_build_object('canRate', reason = 'eligible', 'reason', reason, 'scores', scores);
END $$;
