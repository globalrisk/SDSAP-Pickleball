BEGIN;
INSERT INTO auth.users(id) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","app_metadata":{"role":"admin"}}', true);

CREATE FUNCTION pg_temp.pickle_test_schedule(p_season uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE teams uuid[]; home_ids uuid[]; away_ids uuid[]; snap jsonb; fixtures jsonb;
BEGIN
  SELECT array_agg(t.id ORDER BY (SELECT pool_player_id::text FROM public.players WHERE team_id=t.id ORDER BY duel_rank LIMIT 1)) INTO teams FROM public.teams t WHERE season_id=p_season;
  SELECT array_agg(pool_player_id ORDER BY duel_rank) INTO home_ids FROM public.players WHERE team_id=teams[1];
  SELECT array_agg(pool_player_id ORDER BY duel_rank) INTO away_ids FROM public.players WHERE team_id=teams[2];
  SELECT public.league_duel_rating_snapshot(league_id) INTO snap FROM public.seasons WHERE id=p_season;
  SELECT jsonb_agg(jsonb_build_object('homeTeamId',teams[1],'awayTeamId',teams[2],'roundNumber',round_number,
    'sequenceNumber',sequence_number,'homePoolPlayerIds',ARRAY[home_ids[rank_1],home_ids[rank_2]],
    'awayPoolPlayerIds',ARRAY[away_ids[rank_1],away_ids[rank_2]]) ORDER BY sequence_number) INTO fixtures
    FROM public.league_duel_schedule(cardinality(home_ids));
  PERFORM public.generate_league_duel_matches_atomic(p_season,fixtures,(snap->>'revision')::bigint,snap->>'fingerprint');
END $$;

DO $$
DECLARE league uuid; season uuid; ids uuid[]; payload jsonb; squads jsonb; snap jsonb; preview jsonb;
  outcome jsonb; size integer; total integer; team jsonb; first_season uuid; first_player uuid; prior numeric;
  counter integer; new_season uuid; zero_player uuid; other_season uuid; fingerprint text; first_league uuid;
BEGIN
  INSERT INTO public.player_pool(name,status) VALUES('Zero inactive','inactive') RETURNING id INTO zero_player;
  FOR counter IN 4..8 LOOP
    size := CASE WHEN counter=8 THEN 4 ELSE counter END;
    league := gen_random_uuid(); season := gen_random_uuid(); ids := ARRAY[]::uuid[]; payload := '[]';
    FOR i IN 1..size*2 LOOP
      ids := array_append(ids,gen_random_uuid());
      payload := payload || jsonb_build_array(jsonb_build_object('id',ids[i],'name','Prize player '||i,'is_new',true,'initial_rating',1500));
    END LOOP;
    SELECT array_agg(id ORDER BY id) INTO ids FROM unnest(ids) AS id;
    PERFORM public.create_league_atomic(league,'pickle-test-'||league,'Prize league',season,'Prize season',payload,'[]','[]');
    INSERT INTO public.pickle_league_settings VALUES(league,10000,100000);
    INSERT INTO public.seasons(league_id,name,format,status) VALUES(league,'Inherited season','team_duel','archived') RETURNING id INTO new_season;
    IF (SELECT match_prize FROM public.pickle_season_settings WHERE season_id=new_season) <> 10000 THEN RAISE EXCEPTION 'Defaults not copied'; END IF;
    UPDATE public.pickle_league_settings SET match_prize=20000 WHERE league_id=league;
    IF (SELECT match_prize FROM public.pickle_season_settings WHERE season_id=new_season) <> 10000 THEN RAISE EXCEPTION 'Defaults changed an existing season'; END IF;
    BEGIN
      UPDATE public.pickle_season_settings SET match_prize=1500 WHERE season_id=season;
      RAISE EXCEPTION 'Invalid prize accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    PERFORM public.save_season_roster_atomic(season,ids);
    PERFORM public.set_season_format_atomic(season,'team_duel');
    squads := jsonb_build_array(
      jsonb_build_object('name','A','color','#15803d','poolPlayerIds',to_jsonb(ARRAY(SELECT ids[n] FROM generate_series(1,size*2) n WHERE n%2=1))),
      jsonb_build_object('name','B','color','#1d4ed8','poolPlayerIds',to_jsonb(ARRAY(SELECT ids[n] FROM generate_series(1,size*2) n WHERE n%2=0))));
    snap := public.league_duel_rating_snapshot(league);
    PERFORM public.save_league_duel_draft_atomic(season,squads,(snap->>'revision')::bigint,snap->>'fingerprint');
    PERFORM pg_temp.pickle_test_schedule(season);
    preview := public.pickle_season_preview(season);
    IF (preview->>'complete')::boolean OR EXISTS(SELECT 1 FROM jsonb_array_elements(preview->'squads') s WHERE s->>'championTotal' IS NOT NULL) THEN
      RAISE EXCEPTION 'Pending season awarded a champion'; END IF;
    BEGIN
      PERFORM public.archive_season_with_pickle_points(season,preview->>'fingerprint');
      RAISE EXCEPTION 'Incomplete season archived';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'PICKLE_NOT_READY:%' THEN RAISE; END IF; END;
    UPDATE public.pickle_season_settings SET match_prize=10000,champion_prize=100000,configured=true WHERE season_id=season;
    preview := public.pickle_season_preview(season);
    BEGIN
      PERFORM public.archive_season_with_pickle_points(season,preview->>'fingerprint');
      RAISE EXCEPTION 'Configured incomplete season archived';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'PICKLE_NOT_READY:%' THEN RAISE; END IF; END;
    total := size*(size-1)/2;
    UPDATE public.matches SET status='forfeit', winner_team_id=CASE WHEN duel_sequence_number<=total/2 THEN home_team_id ELSE away_team_id END WHERE season_id=season;
    -- A resolved fixture without a winner cannot award points.
    BEGIN
      UPDATE public.matches SET winner_team_id=NULL WHERE season_id=season AND duel_sequence_number=1;
      preview := public.pickle_season_preview(season);
      PERFORM public.archive_season_with_pickle_points(season,preview->>'fingerprint');
      RAISE EXCEPTION 'Missing winner awarded points';
    EXCEPTION WHEN check_violation THEN NULL; WHEN others THEN IF SQLERRM NOT LIKE 'PICKLE_NOT_READY:%' THEN RAISE; END IF; END;
    UPDATE public.pickle_season_settings SET configured=false WHERE season_id=season;
    preview := public.pickle_season_preview(season);
    BEGIN
      PERFORM public.archive_season_with_pickle_points(season,preview->>'fingerprint');
      RAISE EXCEPTION 'Unsaved prizes awarded points';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'PICKLE_NOT_READY:%' THEN RAISE; END IF; END;
    UPDATE public.pickle_season_settings SET configured=true WHERE season_id=season;
    IF counter=8 THEN UPDATE public.pickle_season_settings SET match_prize=0,champion_prize=0 WHERE season_id=season; END IF;
    preview := public.pickle_season_preview(season);
    fingerprint := preview->>'fingerprint';
    -- Simulate a result racing with the confirmation; stale reviews must fail.
    UPDATE public.matches SET winner_team_id=away_team_id WHERE season_id=season AND duel_sequence_number=1;
    BEGIN
      PERFORM public.archive_season_with_pickle_points(season,fingerprint);
      RAISE EXCEPTION 'Stale distribution was awarded';
    EXCEPTION WHEN serialization_failure THEN NULL; END;
    UPDATE public.matches SET winner_team_id=home_team_id WHERE season_id=season AND duel_sequence_number=1;
    preview := public.pickle_season_preview(season);
    -- User-editable metadata does not grant administrator access.
    PERFORM set_config('request.jwt.claims','{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","user_metadata":{"role":"admin"}}',true);
    BEGIN
      PERFORM public.archive_season_with_pickle_points(season,preview->>'fingerprint');
      RAISE EXCEPTION 'Non-admin awarded prizes';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.pickle_season_settings SET match_prize=40000 WHERE season_id=season;
      IF FOUND THEN RAISE EXCEPTION 'Non-admin changed prizes'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM set_config('request.jwt.claims','{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","app_metadata":{"role":"admin"}}',true);
    BEGIN
      INSERT INTO public.pickle_awards(season_id,league_id,awarded_by,receipt) VALUES(season,league,'dddddddd-dddd-dddd-dddd-dddddddddddd','{}');
      RAISE EXCEPTION 'Admin directly minted points';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    -- Rollback must remove both status change and allocations.
    BEGIN
      PERFORM public.archive_season_with_pickle_points(season,preview->>'fingerprint');
      RAISE EXCEPTION 'test rollback' USING ERRCODE='P0002';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    IF EXISTS(SELECT 1 FROM public.pickle_awards WHERE season_id=season) OR (SELECT status FROM public.seasons WHERE id=season)<>'active' THEN RAISE EXCEPTION 'Partial archive survived rollback'; END IF;
    outcome := public.archive_season_with_pickle_points(season,preview->>'fingerprint');
    IF (outcome->'season'->>'status')<>'archived' OR (SELECT count(*) FROM public.pickle_allocations WHERE season_id=season)<>size*2 THEN RAISE EXCEPTION 'Archive missed an allocation'; END IF;
    IF public.archive_season_with_pickle_points(season,preview->>'fingerprint') <> outcome THEN RAISE EXCEPTION 'Retry changed the award'; END IF;
    FOR team IN SELECT value FROM jsonb_array_elements(preview->'squads') LOOP
      IF (SELECT count(DISTINCT amount) FROM public.pickle_allocations WHERE season_id=season AND team_id=(team->>'id')::uuid)<>1 THEN RAISE EXCEPTION 'Shares were unequal'; END IF;
      IF (team->>'share')::numeric <> round((team->>'total')::numeric/size,6) THEN RAISE EXCEPTION 'Incorrect equal share'; END IF;
      IF (team->>'matchTotal')::numeric <> (team->>'wins')::integer * (CASE WHEN counter=8 THEN 0 ELSE 10000 END) THEN RAISE EXCEPTION 'Forfeit prize missing'; END IF;
      IF counter IN (4,5) AND (team->>'championTotal')::numeric<>50000 THEN RAISE EXCEPTION 'Joint champions did not split bonus'; END IF;
    END LOOP;
    IF counter=8 AND EXISTS(SELECT 1 FROM public.pickle_allocations WHERE season_id=season AND amount<>0) THEN RAISE EXCEPTION 'Zero prizes earned points'; END IF;
    BEGIN UPDATE public.matches SET home_score=1 WHERE season_id=season; RAISE EXCEPTION 'Final result changed'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN DELETE FROM public.matches WHERE season_id=season; RAISE EXCEPTION 'Final result deleted'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN UPDATE public.seasons SET status='active' WHERE id=season; RAISE EXCEPTION 'Final season reopened'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN UPDATE public.pickle_season_settings SET match_prize=0 WHERE season_id=season; RAISE EXCEPTION 'Final prizes changed'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN DELETE FROM public.teams WHERE season_id=season; RAISE EXCEPTION 'Final squad deleted'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN DELETE FROM public.player_pool WHERE id=ids[1]; RAISE EXCEPTION 'Award recipient deleted'; EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL; END;
    UPDATE public.player_pool SET name='Renamed award recipient' WHERE id=ids[1];
    IF first_season IS NULL THEN first_season:=season; first_player:=ids[1]; first_league:=league; END IF;
  END LOOP;
  INSERT INTO public.league_players(league_id,pool_player_id,status) VALUES(first_league,zero_player,'inactive');
  IF (SELECT balance::numeric FROM public.pickle_leaderboard(first_league) WHERE id=zero_player) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Zero inactive league member missing'; END IF;
  SELECT balance::numeric INTO prior FROM public.pickle_leaderboard(first_league) WHERE id=first_player;
  -- The same shared identity earns separate balances in each league.
  SELECT array_agg(pool_player_id ORDER BY pool_player_id) INTO ids FROM public.pickle_allocations WHERE season_id=first_season;
  SELECT jsonb_agg(jsonb_build_object('id',shared.id,'name',(SELECT name FROM public.player_pool WHERE player_pool.id=shared.id),'is_new',false,'initial_rating',1500)) INTO payload FROM unnest(ids) AS shared(id);
  league:=gen_random_uuid(); other_season:=gen_random_uuid();
  PERFORM public.create_league_atomic(league,'shared-prize-'||league,'Second prize league',other_season,'Shared season',payload,'[]','[]');
  IF (SELECT balance::numeric FROM public.pickle_leaderboard(league) WHERE id=first_player) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Points leaked into a new league'; END IF;
  IF EXISTS(SELECT 1 FROM public.pickle_contributions(league,first_player)) THEN RAISE EXCEPTION 'History leaked into a new league'; END IF;
  PERFORM public.save_season_roster_atomic(other_season,ids);
  PERFORM public.set_season_format_atomic(other_season,'team_duel');
  squads:=jsonb_build_array(jsonb_build_object('name','C','color','#15803d','poolPlayerIds',to_jsonb(ARRAY[ids[1],ids[3],ids[5],ids[7]])),jsonb_build_object('name','D','color','#1d4ed8','poolPlayerIds',to_jsonb(ARRAY[ids[2],ids[4],ids[6],ids[8]])));
  snap:=public.league_duel_rating_snapshot(league);
  PERFORM public.save_league_duel_draft_atomic(other_season,squads,(snap->>'revision')::bigint,snap->>'fingerprint');
  PERFORM pg_temp.pickle_test_schedule(other_season);
  UPDATE public.matches SET status='forfeit',winner_team_id=home_team_id WHERE season_id=other_season;
  UPDATE public.pickle_season_settings SET match_prize=1000,configured=true WHERE season_id=other_season;
  PERFORM public.archive_season_with_pickle_points(other_season,public.pickle_season_preview(other_season)->>'fingerprint');
  IF (SELECT balance::numeric FROM public.pickle_leaderboard(first_league) WHERE id=first_player) IS DISTINCT FROM prior THEN RAISE EXCEPTION 'Another league changed the original balance'; END IF;
  IF (SELECT balance::numeric FROM public.pickle_leaderboard(league) WHERE id=first_player) IS DISTINCT FROM
    (SELECT amount FROM public.pickle_allocations WHERE season_id=other_season AND pool_player_id=first_player) THEN RAISE EXCEPTION 'Independent balance incorrect'; END IF;
  IF (SELECT count(*) FROM public.pickle_contributions(first_league,first_player))<>1 OR
    (SELECT count(*) FROM public.pickle_contributions(league,first_player))<>1 THEN RAISE EXCEPTION 'League contribution history incorrect'; END IF;
  IF EXISTS(SELECT 1 FROM public.pickle_leaderboard(league) WHERE id=zero_player) THEN RAISE EXCEPTION 'Nonmember appeared in another league'; END IF;
  IF EXISTS(SELECT 1 FROM public.pickle_leaderboard(gen_random_uuid())) THEN RAISE EXCEPTION 'Unknown league had balances'; END IF;
  -- Convert a disposable completed season to the precise bootstrap identity.
  -- This owner-only fixture setup simulates a season archived before migration.
END $$;
RESET ROLE;
DO $$ DECLARE target uuid; preview jsonb; stored jsonb; league uuid; ids uuid[]; home uuid; away uuid; BEGIN
  SELECT id INTO target FROM public.seasons WHERE name='Inherited season' ORDER BY id LIMIT 1;
  -- Wrong identity cannot be bootstrapped even by an administrator.
  PERFORM set_config('request.jwt.claims','{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","app_metadata":{"role":"admin"}}',true);
  BEGIN PERFORM public.bootstrap_season13_pickle_points(target,1000,10000); RAISE EXCEPTION 'Wrong season bootstrapped';
  EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'PICKLE_BOOTSTRAP:%' THEN RAISE; END IF; END;
  SELECT id INTO league FROM public.leagues WHERE slug='sdsap';
  SELECT array_agg(pool_player_id ORDER BY pool_player_id) INTO ids FROM (
    SELECT pool_player_id FROM public.league_players WHERE league_id=league AND status='active' ORDER BY pool_player_id LIMIT 8
  ) p;
  UPDATE public.seasons SET status='archived' WHERE league_id=league AND status='active';
  INSERT INTO public.seasons(league_id,name,status,format,duel_schedule_mode) VALUES(league,'Season 13','active','team_duel','tier_matched') RETURNING id INTO target;
  INSERT INTO public.season_roster(season_id,league_id,pool_player_id) SELECT target,league,id FROM unnest(ids) id;
  INSERT INTO public.teams(season_id,name,color) VALUES(target,'Old A','#15803d') RETURNING id INTO home;
  INSERT INTO public.teams(season_id,name,color) VALUES(target,'Old B','#1d4ed8') RETURNING id INTO away;
  INSERT INTO public.players(season_id,team_id,pool_player_id,name,duel_rank,duel_tier)
    SELECT target,CASE WHEN n%2=1 THEN home ELSE away END,ids[n],p.name,(n+1)/2,public.league_duel_rank_tier((n+1)/2,4)
    FROM generate_series(1,8) n JOIN public.player_pool p ON p.id=ids[n];
  UPDATE public.seasons SET duel_draft_rating_revision=(public.league_duel_rating_snapshot(league)->>'revision')::bigint,
    duel_draft_rating_fingerprint=public.league_duel_rating_snapshot(league)->>'fingerprint' WHERE id=target;
  INSERT INTO public.matches(season_id,home_team_id,away_team_id,round_number,duel_sequence_number,home_pool_player_ids,away_pool_player_ids,status,winner_team_id)
    SELECT target,home,away,round_number,sequence_number,ARRAY[ids[rank_1*2-1],ids[rank_2*2-1]],ARRAY[ids[rank_1*2],ids[rank_2*2]],'forfeit',home
    FROM public.league_duel_schedule(4);
  SET CONSTRAINTS ALL IMMEDIATE;
  -- Owner-only fixture setup emulates archival before this migration existed.
  ALTER TABLE public.seasons DISABLE TRIGGER aa_guard_pickle_season;
  UPDATE public.seasons SET status='archived' WHERE id=target;
  ALTER TABLE public.seasons ENABLE TRIGGER aa_guard_pickle_season;
  preview:=public.bootstrap_season13_pickle_points(target,10000,100000);
  IF (preview->>'awarded')::boolean OR EXISTS(SELECT 1 FROM public.pickle_awards WHERE season_id=target) OR
    (SELECT configured FROM public.pickle_season_settings WHERE season_id=target) THEN RAISE EXCEPTION 'Dry run mutated Season 13'; END IF;
  BEGIN PERFORM public.bootstrap_season13_pickle_points(target,10000,100000,true,'wrong'); RAISE EXCEPTION 'Stale bootstrap accepted';
    EXCEPTION WHEN serialization_failure THEN NULL; END;
  stored:=public.bootstrap_season13_pickle_points(target,10000,100000,true,preview->>'fingerprint');
  IF NOT (stored->>'awarded')::boolean OR (SELECT count(*) FROM public.pickle_allocations WHERE season_id=target)<>8 THEN RAISE EXCEPTION 'Bootstrap did not award'; END IF;
  IF public.bootstrap_season13_pickle_points(target,10000,100000,true,preview->>'fingerprint')<>stored THEN RAISE EXCEPTION 'Bootstrap retry was not idempotent'; END IF;
  BEGIN PERFORM public.bootstrap_season13_pickle_points(target,20000,100000,true,preview->>'fingerprint'); RAISE EXCEPTION 'Bootstrap overwrote award';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'PICKLE_FINAL:%' THEN RAISE; END IF; END;
  BEGIN UPDATE public.pickle_allocations SET amount=1 WHERE season_id=target; RAISE EXCEPTION 'Owner changed allocations'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM public.pickle_awards WHERE season_id=target; RAISE EXCEPTION 'Owner deleted receipt'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.pickle_leaderboard((SELECT id FROM public.leagues LIMIT 1));
  BEGIN INSERT INTO public.pickle_league_settings(league_id) SELECT id FROM public.leagues LIMIT 1; RAISE EXCEPTION 'Anon edited settings'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.archive_season_with_pickle_points((SELECT id FROM public.seasons LIMIT 1),NULL); RAISE EXCEPTION 'Anon minted awards'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.pickle_allocations VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1000); RAISE EXCEPTION 'Anon wrote allocations'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
