-- Keep league membership/rating writes administrator-only. This private helper
-- grants linked players the single controlled operation of changing their badge.
CREATE SCHEMA player_badges_private;
REVOKE ALL ON SCHEMA player_badges_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA player_badges_private TO authenticated;

CREATE FUNCTION player_badges_private.set_badge(p_league_id uuid, p_player_id uuid, p_badge text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'BADGE_AUTH: Sign in required' USING ERRCODE = '42501';
  END IF;
  -- Use the same lock as account link/unlink to keep ownership stable until save.
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_player_account_links', 0));
  IF coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin'
    AND NOT EXISTS (SELECT 1 FROM public.player_accounts
      WHERE user_id = auth.uid() AND pool_player_id = p_player_id) THEN
    RAISE EXCEPTION 'BADGE_OWNER: You can only edit your own badge' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(p_badge)) > 60 THEN
    RAISE EXCEPTION 'BADGE_LENGTH: Use no more than 60 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE public.league_players SET badge = nullif(btrim(p_badge), '')
    WHERE league_id = p_league_id AND pool_player_id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BADGE_PLAYER: Player not found in this league' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_player_badge(p_league_id uuid, p_player_id uuid, p_badge text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT player_badges_private.set_badge(p_league_id, p_player_id, p_badge)
$$;

REVOKE ALL ON FUNCTION player_badges_private.set_badge(uuid, uuid, text),
  public.set_player_badge(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION player_badges_private.set_badge(uuid, uuid, text),
  public.set_player_badge(uuid, uuid, text) TO authenticated;
