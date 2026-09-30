-- Exercise the live queue against the connected Supabase database.
-- All fixture writes occur inside an exception subtransaction and roll back.
do $test$
declare
  league_id uuid := gen_random_uuid();
  v_season_id uuid := gen_random_uuid();
  player_ids uuid[] := array[]::uuid[];
  team_ids uuid[] := array[]::uuid[];
  player_payload jsonb := '[]'::jsonb;
  team_payload jsonb := '[]'::jsonb;
  match_payload jsonb := '[]'::jsonb;
  ab uuid;
  ac uuid;
  bd uuid;
  cd uuid;
  rejected boolean;
begin
  begin
    for i in 1..8 loop
      player_ids := array_append(player_ids, gen_random_uuid());
      player_payload := player_payload || jsonb_build_array(jsonb_build_object(
        'id', player_ids[i], 'name', 'Court test player ' || i,
        'is_new', true, 'initial_rating', 1500
      ));
    end loop;

    for i in 1..4 loop
      team_ids := array_append(team_ids, gen_random_uuid());
      team_payload := team_payload || jsonb_build_array(jsonb_build_object(
        'id', team_ids[i], 'name', 'Court test team ' || i,
        'color', '#008000',
        'poolPlayerIds', jsonb_build_array(player_ids[i * 2 - 1], player_ids[i * 2])
      ));
    end loop;

    for i in 1..4 loop
      for j in i + 1..4 loop
        match_payload := match_payload || jsonb_build_array(jsonb_build_object(
          'home_team_id', team_ids[i], 'away_team_id', team_ids[j],
          'round_number', 1
        ));
      end loop;
    end loop;

    perform public.create_league_atomic(
      league_id,
      'court-test-' || replace(league_id::text, '-', ''),
      'Court transition test', v_season_id, 'Season 1',
      player_payload, team_payload, match_payload
    );
    update public.players set is_present = true where players.season_id = v_season_id;

    select id into ab from public.matches
    where matches.season_id = v_season_id
      and home_team_id = team_ids[1] and away_team_id = team_ids[2];
    select id into ac from public.matches
    where matches.season_id = v_season_id
      and home_team_id = team_ids[1] and away_team_id = team_ids[3];
    select id into bd from public.matches
    where matches.season_id = v_season_id
      and home_team_id = team_ids[2] and away_team_id = team_ids[4];
    select id into cd from public.matches
    where matches.season_id = v_season_id
      and home_team_id = team_ids[3] and away_team_id = team_ids[4];

    perform public.set_match_live_status(ab, 'playing');
    if (select live_court_number from public.matches where id = ab) is distinct from 1 then
      raise exception 'The first match did not take Court 1';
    end if;

    rejected := false;
    begin
      perform public.set_match_live_status(cd, 'playing');
    exception when others then
      if sqlerrm = 'All configured courts are currently occupied' then
        rejected := true;
      else
        raise;
      end if;
    end;
    if not rejected then raise exception 'The one-court limit was not enforced'; end if;

    perform public.set_live_court_count(v_season_id, 2);

    rejected := false;
    begin
      perform public.set_match_live_status(ac, 'playing');
    exception when check_violation then
      if sqlerrm = 'A team in this match is already playing on another court' then
        rejected := true;
      else
        raise;
      end if;
    end;
    if not rejected then raise exception 'A shared team was allowed onto Court 2'; end if;

    rejected := false;
    begin
      perform public.set_match_live_status(bd, 'up_next');
    exception when check_violation then
      if sqlerrm = 'A team in this match is already playing on another court' then
        rejected := true;
      else
        raise;
      end if;
    end;
    if not rejected then raise exception 'A playing team was queued Up Next'; end if;

    perform public.set_match_live_status(cd, 'playing');
    if (select live_court_number from public.matches where id = cd) is distinct from 2 then
      raise exception 'The independent match did not take Court 2';
    end if;

    rejected := false;
    begin
      perform public.set_live_court_count(v_season_id, 1);
    exception when others then
      if sqlerrm = 'Finish matches on higher-numbered courts before reducing the court count' then
        rejected := true;
      else
        raise;
      end if;
    end;
    if not rejected then raise exception 'Court 2 was removed while occupied'; end if;

    perform public.set_match_live_status(cd, 'available');
    perform public.set_live_court_count(v_season_id, 1);
    if (select live_court_count from public.seasons where id = v_season_id) is distinct from 1 then
      raise exception 'Could not return to one court';
    end if;

    raise exception '__ROLLBACK_COURT_TEST__';
  exception when others then
    if sqlerrm <> '__ROLLBACK_COURT_TEST__' then raise; end if;
  end;
  if exists (select 1 from public.leagues where id = league_id) then
    raise exception 'Court test fixture was not rolled back';
  end if;
end
$test$;

select true as live_court_transitions_passed;
