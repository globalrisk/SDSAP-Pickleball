CREATE OR REPLACE FUNCTION public.delete_team_duel_squad_atomic(
  p_squad_id uuid,
  p_expected_revision integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_revision integer;
BEGIN
  IF coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrator access is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('team-duel-squad-delete:' || p_squad_id::text, 0)
  );

  SELECT revision
  INTO v_revision
  FROM public.team_duel_squads
  WHERE id = p_squad_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team Duel squad was not found';
  END IF;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Squad changed on another device';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.team_duel_events
    WHERE squad_a_id = p_squad_id OR squad_b_id = p_squad_id
  ) THEN
    RAISE EXCEPTION 'A squad used by a Team Duel cannot be deleted; archive it instead';
  END IF;

  DELETE FROM public.team_duel_squads
  WHERE id = p_squad_id AND revision = p_expected_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Squad changed on another device';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_team_duel_squad_atomic(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_team_duel_squad_atomic(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_team_duel_squad_atomic(uuid, integer) TO authenticated;
