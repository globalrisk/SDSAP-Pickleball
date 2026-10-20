-- Rename only the identity currently owned by the caller. Keep the privileged
-- implementation outside the exposed schema and do not widen table policies.
CREATE FUNCTION pickle_private.rename_my_player(p_expected_player_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  player_id uuid;
  player_name text := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
BEGIN
  -- Serialize with administrator unlinking before reading the account link.
  player_id := pickle_private.lock_player_account();
  IF player_id IS NULL OR player_id IS DISTINCT FROM p_expected_player_id THEN
    RAISE EXCEPTION 'PLAYER_NAME_LINK: A matching linked player account is required' USING ERRCODE = '42501';
  END IF;
  IF player_name IS NULL OR char_length(player_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'PLAYER_NAME_INVALID: Use 1-120 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.player_pool SET name = player_name WHERE id = player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAYER_NAME_LINK: Linked player no longer exists' USING ERRCODE = '42501';
  END IF;
  -- sync_shared_player_name updates denormalized league roster names in the
  -- same transaction. Player IDs, financial records and match results stay put.
  RETURN jsonb_build_object('playerId', player_id, 'name', player_name);
END;
$$;
REVOKE ALL ON FUNCTION pickle_private.rename_my_player(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pickle_private.rename_my_player(uuid, text) TO authenticated;

CREATE FUNCTION public.rename_my_player(p_expected_player_id uuid, p_name text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT pickle_private.rename_my_player(p_expected_player_id, p_name) $$;
REVOKE ALL ON FUNCTION public.rename_my_player(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_my_player(uuid, text) TO authenticated;
