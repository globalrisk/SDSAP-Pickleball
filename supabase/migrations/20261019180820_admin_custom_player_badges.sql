-- No generated titles are persisted. Existing players start with no badge.
-- League membership RLS already permits public reads and administrator-only writes.
ALTER TABLE public.league_players ADD COLUMN badge text
  CHECK (badge IS NULL OR (badge = btrim(badge) AND char_length(badge) BETWEEN 1 AND 60));

CREATE FUNCTION public.set_player_badge(p_league_id uuid, p_player_id uuid, p_badge text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'BADGE_ADMIN: Administrator access required' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.set_player_badge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_player_badge(uuid, uuid, text) TO authenticated;
