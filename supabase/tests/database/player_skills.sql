BEGIN;
DO $$
DECLARE api_role text; statement text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'player_skills_private.ratings'::regclass) THEN
    RAISE EXCEPTION 'Skill submissions require RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('player_skill_summary','my_player_skill_rating','save_player_skill_rating','remove_player_skill_rating') AND p.prosecdef) THEN
    RAISE EXCEPTION 'Public skill wrappers must be invoker functions';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', api_role);
    FOREACH statement IN ARRAY ARRAY[
      'SELECT * FROM player_skills_private.ratings',
      'INSERT INTO player_skills_private.ratings(rater_id,target_id,drive) VALUES(gen_random_uuid(),gen_random_uuid(),100)',
      'UPDATE player_skills_private.ratings SET drive=100',
      'DELETE FROM player_skills_private.ratings'
    ] LOOP
      BEGIN EXECUTE statement; RAISE EXCEPTION 'Raw skill submissions exposed: % to %', statement, api_role;
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END LOOP;
    PERFORM set_config('request.jwt.claims','{}',true);
    BEGIN PERFORM public.my_player_skill_rating(gen_random_uuid(),gen_random_uuid()); RAISE EXCEPTION 'Unsigned caller read private vote';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.save_player_skill_rating(gen_random_uuid(),gen_random_uuid(),'{"drive":100}'); RAISE EXCEPTION 'Unsigned caller saved vote';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.remove_player_skill_rating(gen_random_uuid()); RAISE EXCEPTION 'Unsigned caller removed vote';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;
ROLLBACK;
