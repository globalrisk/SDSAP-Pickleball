-- Registered emails are private. Only a signed-in league administrator can
-- inspect this directory; no Auth tokens, credentials or user IDs are returned.
CREATE FUNCTION public.admin_player_account_directory(
  p_search text DEFAULT '', p_offset integer DEFAULT 0, p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  PERFORM pickle_private.require_admin();
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid account directory page' USING ERRCODE = '22023';
  END IF;
  WITH matching AS (
    SELECT u.id, u.email::text AS email, a.pool_player_id AS player_id, p.name AS player_name
    FROM auth.users u
    LEFT JOIN public.player_accounts a ON a.user_id = u.id
    LEFT JOIN public.player_pool p ON p.id = a.pool_player_id
    WHERE u.email IS NOT NULL AND u.email <> ''
      AND strpos(lower(u.email), lower(trim(coalesce(p_search, '')))) > 0
  ), page AS (
    SELECT * FROM matching ORDER BY lower(email), id LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'email', email, 'playerId', player_id, 'playerName', player_name
    ) ORDER BY lower(email), id) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM matching)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_player_account_directory(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_player_account_directory(text,integer,integer) TO authenticated;
