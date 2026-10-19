BEGIN;
DO $$
DECLARE
  league uuid:=gen_random_uuid(); season uuid:=gen_random_uuid(); admin uuid:=gen_random_uuid();
  users uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  ids uuid[]; seeds jsonb; home uuid; away uuid; m uuid; history uuid; prize_team uuid;
  offer uuid; home_offer uuid; away_offer uuid; request uuid:=gen_random_uuid(); preview jsonb;
  fixture public.matches;
BEGIN
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES(admin,'self-bet-admin@test.local','{"role":"admin"}');
  FOR n IN 1..6 LOOP
    INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES(users[n],'self-bettor-'||n||'@test.local','{}');
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin,'app_metadata',jsonb_build_object('role','admin'))::text,true);
  SELECT array_agg(id ORDER BY n),jsonb_agg(jsonb_build_object('id',id,'name','Self bet player '||n,'is_new',true,'initial_rating',1500))
    INTO ids,seeds FROM (SELECT n,gen_random_uuid() id FROM generate_series(1,6)n)q;
  PERFORM public.create_league_atomic(league,'self-bet-test-'||league::text,'Self bet tests',season,'Self bet season',seeds,'[]','[]');
  PERFORM public.save_season_roster_atomic(season,ids);
  INSERT INTO public.teams(season_id,name,color) VALUES(season,'Home','#15803d') RETURNING id INTO home;
  INSERT INTO public.teams(season_id,name,color) VALUES(season,'Away','#1d4ed8') RETURNING id INTO away;
  FOR n IN 1..4 LOOP
    INSERT INTO public.players(name,team_id,pool_player_id,season_id)
      VALUES('Self bet player '||n,CASE WHEN n<3 THEN home ELSE away END,ids[n],season);
  END LOOP;
  -- Start with a legacy round-robin fixture without lineup snapshots.
  INSERT INTO public.matches(season_id,home_team_id,away_team_id,round_number)
    VALUES(season,home,away,1) RETURNING id INTO m;
  INSERT INTO public.seasons(league_id,name,status) VALUES(league,'Historical self-bet prize','archived') RETURNING id INTO history;
  INSERT INTO public.teams(season_id,name,color) VALUES(history,'Prize team','#15803d') RETURNING id INTO prize_team;
  INSERT INTO public.pickle_awards(season_id,league_id,awarded_by,receipt) VALUES(history,league,admin,'{}');
  FOR n IN 1..6 LOOP
    INSERT INTO public.pickle_allocations(season_id,pool_player_id,team_id,amount) VALUES(history,ids[n],prize_team,10000);
    PERFORM public.link_player_account(ids[n],'self-bettor-'||n||'@test.local');
  END LOOP;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1])::text,true);
  BEGIN
    PERFORM public.create_pickle_bet(m,away,1000,1000,gen_random_uuid());
    RAISE EXCEPTION 'Home participant backed away';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'BET_SELF_SIDE:%' THEN RAISE; END IF; END;
  offer:=public.create_pickle_bet(m,home,1000,2000,request);
  IF public.create_pickle_bet(m,home,1000,2000,request)<>offer THEN RAISE EXCEPTION 'Self offer retry duplicated'; END IF;
  IF (public.pickle_wallet(league)->>'reserved')::numeric<>1000 THEN RAISE EXCEPTION 'Self stake not reserved once'; END IF;
  BEGIN
    PERFORM public.accept_pickle_bet(offer,gen_random_uuid()); RAISE EXCEPTION 'Creator accepted own offer';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'BET_TAKEN:%' THEN RAISE; END IF; END;
  PERFORM public.cancel_pickle_bet(offer);
  IF (public.pickle_wallet(league)->>'available')::numeric<>10000 THEN RAISE EXCEPTION 'Self offer cancellation lost funds'; END IF;

  -- Freeze the same pair identities, as Team Duel fixtures do.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin,'app_metadata',jsonb_build_object('role','admin'))::text,true);
  UPDATE public.matches SET home_pool_player_ids=ids[1:2],away_pool_player_ids=ids[3:4] WHERE id=m;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1])::text,true);
  home_offer:=public.create_pickle_bet(m,home,1000,2000,gen_random_uuid());
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[2])::text,true);
  BEGIN
    PERFORM public.accept_pickle_bet(home_offer,gen_random_uuid()); RAISE EXCEPTION 'Teammate accepted against own pair';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'BET_SELF_SIDE:%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[3])::text,true);
  request:=gen_random_uuid();
  PERFORM public.accept_pickle_bet(home_offer,request);
  PERFORM public.accept_pickle_bet(home_offer,request);
  IF (public.pickle_wallet(league)->>'reserved')::numeric<>2000 THEN RAISE EXCEPTION 'Self acceptance reserved wrong amount'; END IF;
  BEGIN
    PERFORM public.create_pickle_bet(m,home,1000,1000,gen_random_uuid()); RAISE EXCEPTION 'Away participant backed home';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'BET_SELF_SIDE:%' THEN RAISE; END IF; END;
  away_offer:=public.create_pickle_bet(m,away,1000,1000,gen_random_uuid());
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[4])::text,true);
  BEGIN
    PERFORM public.accept_pickle_bet(away_offer,gen_random_uuid()); RAISE EXCEPTION 'Away teammate accepted against own pair';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'BET_SELF_SIDE:%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1])::text,true);
  PERFORM public.accept_pickle_bet(away_offer,gen_random_uuid());

  -- Spectators keep both sides available.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[5])::text,true);
  offer:=public.create_pickle_bet(m,home,1000,1000,gen_random_uuid());
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[6])::text,true);
  PERFORM public.accept_pickle_bet(offer,gen_random_uuid());
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin,'app_metadata',jsonb_build_object('role','admin'))::text,true);
  UPDATE public.players SET is_present=true WHERE season_id=season;
  UPDATE public.matches SET live_status='playing',live_court_number=1 WHERE id=m;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[4])::text,true);
  BEGIN
    PERFORM public.create_pickle_bet(m,away,1000,1000,gen_random_uuid()); RAISE EXCEPTION 'Self bet after match start';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'BET_CLOSED:%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin,'app_metadata',jsonb_build_object('role','admin'))::text,true);
  UPDATE public.matches SET status='completed',winner_team_id=home,home_score=11,away_score=7 WHERE id=m;
  preview:=public.pickle_settlement_preview(m);
  PERFORM public.confirm_pickle_settlement(m,preview->>'fingerprint',0);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1])::text,true);
  IF (public.pickle_wallet(league)->>'balance')::numeric<>13000 OR (public.pickle_wallet(league)->>'reserved')::numeric<>0 THEN
    RAISE EXCEPTION 'Self bet winning payout wrong';
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[3])::text,true);
  IF (public.pickle_wallet(league)->>'balance')::numeric<>7000 OR (public.pickle_wallet(league)->>'reserved')::numeric<>0 THEN
    RAISE EXCEPTION 'Self bet losing payout wrong';
  END IF;
  EXECUTE 'RESET ROLE';
  -- A squad member outside the frozen pair remains a spectator.
  SELECT * INTO fixture FROM public.matches WHERE id=m;
  fixture.home_pool_player_ids:=ARRAY[ids[2],ids[5]];
  PERFORM pickle_private.require_backed_side(fixture,ids[1],away);
  BEGIN
    PERFORM pickle_private.require_backed_side(fixture,ids[5],away); RAISE EXCEPTION 'Snapshot participant backed against self';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'BET_SELF_SIDE:%' THEN RAISE; END IF; END;
  IF has_function_privilege('authenticated','pickle_private.require_backed_side(public.matches,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','pickle_private.require_backed_side(public.matches,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Private side check exposed to API callers';
  END IF;
END $$;
ROLLBACK;
