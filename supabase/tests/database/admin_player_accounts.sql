BEGIN;
DO $$
DECLARE administrator uuid := gen_random_uuid(); player_user uuid := gen_random_uuid();
  waiting_user uuid := gen_random_uuid(); player uuid := gen_random_uuid(); result jsonb;
BEGIN
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
    (administrator,'directory-admin@example.test','{"role":"admin"}'),
    (player_user,'directory-linked@example.test','{}'),
    (waiting_user,'directory-waiting@example.test','{}');
  INSERT INTO public.player_pool(id,name) VALUES(player,'Directory player');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',administrator,'app_metadata',jsonb_build_object('role','admin'))::text,true);
  PERFORM public.link_player_account(player,'directory-linked@example.test');
  EXECUTE 'SET LOCAL ROLE authenticated';
  result := public.admin_player_account_directory('DIRECTORY-',0,25);
  IF (result->>'total')::integer <> 3 OR jsonb_array_length(result->'accounts') <> 3 THEN RAISE EXCEPTION 'Registered accounts missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'accounts') a WHERE a->>'email'='directory-waiting@example.test' AND a->>'playerId' IS NULL) THEN RAISE EXCEPTION 'Unlinked account missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'accounts') a WHERE a->>'email'='directory-linked@example.test' AND a->>'playerName'='Directory player') THEN RAISE EXCEPTION 'Linked account missing'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'accounts') a WHERE a ? 'id' OR a ? 'userId' OR a ? 'password') THEN RAISE EXCEPTION 'Unnecessary Auth fields exposed'; END IF;
  result := public.admin_player_account_directory('DIRECTORY-',1,1);
  IF (result->>'total')::integer <> 3 OR jsonb_array_length(result->'accounts') <> 1 OR result->'accounts'->0->>'email' <> 'directory-linked@example.test' THEN RAISE EXCEPTION 'Pagination unstable'; END IF;
  result := public.admin_player_account_directory('no-matching-email',0,25);
  IF (result->>'total')::integer <> 0 OR result->'accounts' <> '[]'::jsonb THEN RAISE EXCEPTION 'Empty search incorrect'; END IF;
  BEGIN PERFORM public.admin_player_account_directory('',0,1000); RAISE EXCEPTION 'Page limit ignored'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.admin_player_account_directory('',-1,25); RAISE EXCEPTION 'Negative offset accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',player_user,'user_metadata',jsonb_build_object('role','admin'))::text,true);
  BEGIN PERFORM public.admin_player_account_directory('',0,25); RAISE EXCEPTION 'Non-admin read emails'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{}',true);
  BEGIN PERFORM public.admin_player_account_directory('',0,25); RAISE EXCEPTION 'Unsigned authenticated caller read emails'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.admin_player_account_directory('',0,25); RAISE EXCEPTION 'Anonymous read emails'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',administrator,'app_metadata',jsonb_build_object('role','admin'))::text,true);
  UPDATE public.player_pool SET name='Renamed directory player' WHERE id=player;
  result := public.admin_player_account_directory('directory-linked',0,25);
  IF result->'accounts'->0->>'playerName' <> 'Renamed directory player' THEN RAISE EXCEPTION 'Rename not reflected'; END IF;
END $$;
ROLLBACK;
