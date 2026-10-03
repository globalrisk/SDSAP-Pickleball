-- Real PostgreSQL constraints and RPCs, rolled back after every assertion.
BEGIN;
CREATE FUNCTION pg_temp.generate_test_duel(p_season_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE squads uuid[]; home_ids uuid[]; away_ids uuid[]; fixtures jsonb; snapshot jsonb;
BEGIN
  SELECT array_agg(team.id ORDER BY (SELECT pool_player_id::text FROM public.players WHERE team_id = team.id ORDER BY duel_rank LIMIT 1))
    INTO squads FROM public.teams AS team WHERE team.season_id = p_season_id;
  SELECT array_agg(pool_player_id ORDER BY duel_rank) INTO home_ids FROM public.players WHERE team_id = squads[1];
  SELECT array_agg(pool_player_id ORDER BY duel_rank) INTO away_ids FROM public.players WHERE team_id = squads[2];
  SELECT public.league_duel_rating_snapshot(league_id) INTO snapshot FROM public.seasons WHERE id = p_season_id;
  SELECT jsonb_agg(jsonb_build_object('homeTeamId', squads[1], 'awayTeamId', squads[2], 'roundNumber', round_number,
    'sequenceNumber', sequence_number, 'homePoolPlayerIds', ARRAY[home_ids[rank_1], home_ids[rank_2]],
    'awayPoolPlayerIds', ARRAY[away_ids[rank_1], away_ids[rank_2]]) ORDER BY sequence_number) INTO fixtures
    FROM public.league_duel_schedule(cardinality(home_ids));
  RETURN public.generate_league_duel_matches_atomic(p_season_id, fixtures, (snapshot->>'revision')::bigint, snapshot->>'fingerprint');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
DO $$
DECLARE league uuid; season uuid; ids uuid[]; payload jsonb; squads jsonb; snapshot jsonb;
  home uuid; away uuid; first_game uuid; second_game uuid; overlapping uuid;
  first_player uuid; fixture public.matches; size integer; total integer; second_ids uuid[];
  invalid_squads jsonb; foreign_player uuid; previous_home uuid;
BEGIN
  FOR size IN 4..7 LOOP
    league := gen_random_uuid(); season := gen_random_uuid(); ids := ARRAY[]::uuid[]; payload := '[]'::jsonb;
    FOR i IN 1..size * 2 LOOP
      ids := array_append(ids, gen_random_uuid());
      payload := payload || jsonb_build_array(jsonb_build_object('id', ids[i], 'name', 'Duel player ' || i, 'is_new', true, 'initial_rating', 1500));
    END LOOP;
    SELECT array_agg(id ORDER BY id) INTO ids FROM unnest(ids) AS id;
    PERFORM public.create_league_atomic(league, 'duel-test-' || league, 'Duel test', season, 'Duel season', payload, '[]', '[]');
    PERFORM public.save_season_roster_atomic(season, ids);
    -- Switching clears ordinary draft teams and retains all selected players.
    PERFORM public.save_selected_season_teams_atomic(season, jsonb_build_array(
      jsonb_build_object('name','Old A','color','#15803d','poolPlayerIds',to_jsonb(ids[1:2])),
      jsonb_build_object('name','Old B','color','#1d4ed8','poolPlayerIds',to_jsonb(ids[3:4]))));
    PERFORM public.set_season_format_atomic(season, 'team_duel');
    IF EXISTS (SELECT 1 FROM public.teams WHERE season_id = season) OR
      (SELECT count(*) FROM public.season_roster WHERE season_id = season) <> size * 2 THEN RAISE EXCEPTION 'Format switch did not preserve roster'; END IF;
    squads := jsonb_build_array(
      jsonb_build_object('name','Squad A','color','#15803d','poolPlayerIds',to_jsonb(ARRAY(SELECT ids[position] FROM generate_series(1, size * 2) AS position WHERE position % 2 = 1 ORDER BY position))),
      jsonb_build_object('name','Squad B','color','#1d4ed8','poolPlayerIds',to_jsonb(ARRAY(SELECT ids[position] FROM generate_series(1, size * 2) AS position WHERE position % 2 = 0 ORDER BY position))));
    snapshot := public.league_duel_rating_snapshot(league);
    -- A shared identity without membership cannot enter a league squad.
    foreign_player := gen_random_uuid();
    INSERT INTO public.player_pool(id, name) VALUES (foreign_player, 'Other league player');
    invalid_squads := jsonb_set(squads, '{0,poolPlayerIds,0}', to_jsonb(foreign_player::text));
    BEGIN
      PERFORM public.save_league_duel_draft_atomic(season, invalid_squads, (snapshot->>'revision')::bigint, snapshot->>'fingerprint');
      RAISE EXCEPTION 'A foreign league player entered a squad';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Every squad player must be selected and active%' THEN RAISE; END IF; END;
    invalid_squads := jsonb_set(squads, '{1,poolPlayerIds,0}', to_jsonb(ids[1]::text));
    BEGIN
      PERFORM public.save_league_duel_draft_atomic(season, invalid_squads, (snapshot->>'revision')::bigint, snapshot->>'fingerprint');
      RAISE EXCEPTION 'Duplicate player entered both squads';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'The squads must cover the complete%' THEN RAISE; END IF; END;
    BEGIN
      PERFORM public.save_league_duel_draft_atomic(season, squads, -1, snapshot->>'fingerprint');
      RAISE EXCEPTION 'Stale revision was accepted';
    EXCEPTION WHEN serialization_failure THEN NULL; END;
    BEGIN
      UPDATE public.league_players SET rating = 1550 WHERE league_id = league AND pool_player_id = ids[1];
      PERFORM public.save_league_duel_draft_atomic(season, squads, (snapshot->>'revision')::bigint, snapshot->>'fingerprint');
      RAISE EXCEPTION 'Changed rating with unchanged revision was accepted';
    EXCEPTION WHEN serialization_failure THEN NULL; END;
    PERFORM public.save_league_duel_draft_atomic(season, squads, (snapshot->>'revision')::bigint, snapshot->>'fingerprint');
    BEGIN
      DELETE FROM public.teams WHERE id = (SELECT id FROM public.teams WHERE season_id = season LIMIT 1);
      SET CONSTRAINTS ALL IMMEDIATE;
      RAISE EXCEPTION 'A single squad was allowed to remain';
    EXCEPTION WHEN check_violation THEN NULL; END;
    -- Changing a selected roster clears the saved squads, even if it still fits.
    PERFORM public.save_season_roster_atomic(season, ids);
    IF EXISTS (SELECT 1 FROM public.teams WHERE season_id = season) THEN RAISE EXCEPTION 'Roster change kept the old draft'; END IF;
    PERFORM public.save_league_duel_draft_atomic(season, squads, (snapshot->>'revision')::bigint, snapshot->>'fingerprint');
    BEGIN
      UPDATE public.rating_state SET revision = revision + 1 WHERE league_id = league;
      PERFORM pg_temp.generate_test_duel(season);
      RAISE EXCEPTION 'Stale generation was accepted';
    EXCEPTION WHEN serialization_failure THEN NULL; END;
    total := pg_temp.generate_test_duel(season);
    IF total <> size * (size - 1) / 2 THEN RAISE EXCEPTION 'Incorrect game count for size %', size; END IF;
    PERFORM public.validate_league_duel_season(season);
    IF EXISTS (SELECT 1 FROM public.players AS player WHERE player.season_id = season AND
      (SELECT count(*) FROM public.matches AS match WHERE match.season_id = season
        AND player.pool_player_id = ANY(public.league_match_participant_ids(match))) <> size - 1) THEN RAISE EXCEPTION 'Unequal player appearances'; END IF;
    SELECT * INTO fixture FROM public.matches WHERE season_id = season ORDER BY duel_sequence_number LIMIT 1;
    home := fixture.home_team_id; away := fixture.away_team_id; first_game := fixture.id;
    IF previous_home IS NOT NULL THEN
      BEGIN
        INSERT INTO public.matches(season_id, home_team_id, away_team_id, round_number, duel_sequence_number, home_pool_player_ids, away_pool_player_ids)
          VALUES(season, previous_home, away, 1, total + 1, fixture.home_pool_player_ids, fixture.away_pool_player_ids);
        RAISE EXCEPTION 'A foreign league squad entered a fixture';
      EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'A Team Duel fixture requires%' THEN RAISE; END IF; END;
    END IF;
    previous_home := home;
    SELECT id INTO first_player FROM public.players WHERE team_id = home AND pool_player_id = fixture.home_pool_player_ids[1];
    BEGIN
      UPDATE public.players SET duel_rank = NULL WHERE id = first_player;
      RAISE EXCEPTION 'Rank mutation was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      DELETE FROM public.players WHERE id = first_player;
      RAISE EXCEPTION 'Member deletion was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      UPDATE public.season_roster SET pool_player_id = foreign_player
        WHERE season_id = season AND pool_player_id = ids[1];
      RAISE EXCEPTION 'Frozen roster identity was changed by a direct write';
    EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.matches SET home_pool_player_ids = ARRAY[ids[1], ids[2]] WHERE id = first_game;
      IF fixture.home_pool_player_ids IS DISTINCT FROM ARRAY[ids[1], ids[2]] THEN RAISE EXCEPTION 'Lineup mutation was accepted'; END IF;
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      DELETE FROM public.matches WHERE id = first_game;
      PERFORM public.validate_league_duel_season(season);
      RAISE EXCEPTION 'Fixture deletion was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      PERFORM public.set_season_format_atomic(season, 'round_robin');
      RAISE EXCEPTION 'Generated format was changed';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Season format is locked%' THEN RAISE; END IF; END;
    BEGIN
      UPDATE public.matches SET status = 'completed', winner_team_id = home, home_score = 11, away_score = 10 WHERE id = first_game;
      RAISE EXCEPTION 'Invalid score was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;

    UPDATE public.players SET is_present = true WHERE season_id = season;
    PERFORM public.set_live_court_count(season, 2);
    PERFORM public.set_match_live_status(first_game, 'playing');
    SELECT id INTO second_game FROM public.matches WHERE season_id = season AND id <> first_game
      AND NOT (public.league_match_participant_ids(matches) && public.league_match_participant_ids(fixture)) ORDER BY duel_sequence_number LIMIT 1;
    SELECT id INTO overlapping FROM public.matches WHERE season_id = season AND id <> first_game
      AND public.league_match_participant_ids(matches) && public.league_match_participant_ids(fixture) ORDER BY duel_sequence_number LIMIT 1;
    BEGIN
      PERFORM public.set_match_live_status(overlapping, 'playing');
      RAISE EXCEPTION 'Overlapping player was allowed onto another court';
    EXCEPTION WHEN check_violation THEN NULL; END;
    PERFORM public.set_match_live_status(second_game, 'up_next');
    SELECT public.league_match_participant_ids(match) INTO second_ids FROM public.matches AS match WHERE id = second_game;
    -- Absent squadmates outside these two games do not release an independent queue.
    IF size >= 5 THEN
      UPDATE public.players SET is_present = false WHERE id = (
        SELECT player.id FROM public.players AS player WHERE player.season_id = season
          AND NOT (player.pool_player_id = ANY(public.league_match_participant_ids(fixture)))
          AND NOT (player.pool_player_id = ANY(second_ids)) LIMIT 1);
      IF (SELECT live_status FROM public.matches WHERE id = second_game) <> 'up_next' THEN RAISE EXCEPTION 'Unrelated attendance released queue'; END IF;
    END IF;
    PERFORM public.set_match_live_status(second_game, 'playing');
    BEGIN
      PERFORM public.set_player_presence(first_player, false);
      RAISE EXCEPTION 'On-court player became absent';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'This player is currently%' THEN RAISE; END IF; END;
    PERFORM public.set_match_live_status(first_game, 'available');
    PERFORM public.set_match_live_status(second_game, 'available');
    UPDATE public.players SET is_present = true WHERE season_id = season;
    PERFORM public.set_match_live_status(first_game, 'up_next');
    PERFORM public.set_player_presence(first_player, false);
    IF (SELECT live_status FROM public.matches WHERE id = first_game) <> 'available' THEN RAISE EXCEPTION 'Affected queue was not released'; END IF;
    -- Clinching is not completion, and archiving cannot discard unresolved games.
    UPDATE public.matches SET status = 'forfeit', winner_team_id = home
      WHERE season_id = season AND duel_sequence_number <= total / 2 + 1;
    BEGIN
      UPDATE public.seasons SET status = 'archived' WHERE id = season;
      RAISE EXCEPTION 'An early clinch completed the season';
    EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Resolve every Team Duel game%' THEN RAISE; END IF; END;
    UPDATE public.matches SET status = 'forfeit', winner_team_id = away WHERE season_id = season AND status = 'scheduled';
    UPDATE public.seasons SET status = 'archived' WHERE id = season;
  END LOOP;
END;
$$;

-- The trigger also protects writes made with table-owner privileges.
RESET ROLE;
DO $$ BEGIN
  BEGIN
    UPDATE public.season_roster SET pool_player_id = gen_random_uuid()
      WHERE season_id = (SELECT id FROM public.seasons WHERE format = 'team_duel' ORDER BY id LIMIT 1);
    RAISE EXCEPTION 'Owner privileges bypassed frozen roster validation';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;

-- A non-admin authenticated account cannot invoke any setup operation.
SELECT set_config('request.jwt.claims', '{"app_metadata":{"role":"viewer"}}', true);
DO $$ BEGIN
  BEGIN PERFORM public.set_season_format_atomic(gen_random_uuid(), 'team_duel');
    RAISE EXCEPTION 'Viewer changed format';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'Administrator access is required' THEN RAISE; END IF; END;
  BEGIN PERFORM public.generate_league_duel_matches_atomic(gen_random_uuid(), '[]', 0, '');
    RAISE EXCEPTION 'Viewer generated games';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'Administrator access is required' THEN RAISE; END IF; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.generate_league_duel_matches_atomic(gen_random_uuid(), '[]', 0, '');
    RAISE EXCEPTION 'Anonymous user generated games';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
