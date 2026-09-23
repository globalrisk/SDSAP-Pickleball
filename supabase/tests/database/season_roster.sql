-- Run after migrations against a disposable database.
begin;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);

select create_league_atomic(
  '71000000-0000-4000-8000-000000000001'::uuid,
  'integration-season-roster',
  'Integration Season Roster',
  '72000000-0000-4000-8000-000000000001'::uuid,
  'Season 1',
  jsonb_build_array(
    jsonb_build_object('id','73000000-0000-4000-8000-000000000001','name','Player 1','is_new',true,'initial_rating',1500),
    jsonb_build_object('id','73000000-0000-4000-8000-000000000002','name','Player 2','is_new',true,'initial_rating',1500),
    jsonb_build_object('id','73000000-0000-4000-8000-000000000003','name','Player 3','is_new',true,'initial_rating',1500)
  ),
  jsonb_build_array(
    jsonb_build_object('id','74000000-0000-4000-8000-000000000001','name','First team','color','#008000','poolPlayerIds',jsonb_build_array('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002'))
  ),
  '[]'::jsonb
);

do $$
begin
  if (select count(*) from public.season_roster
      where season_id = '72000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'initial team players were not enrolled';
  end if;
end;
$$;

select save_season_roster_atomic(
  '72000000-0000-4000-8000-000000000001'::uuid,
  array[
    '73000000-0000-4000-8000-000000000001'::uuid,
    '73000000-0000-4000-8000-000000000002'::uuid,
    '73000000-0000-4000-8000-000000000003'::uuid
  ]
);

do $$
begin
  if (select count(*) from public.season_roster
      where season_id = '72000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'season selection was not saved';
  end if;

  begin
    perform save_season_roster_atomic(
      '72000000-0000-4000-8000-000000000001'::uuid,
      array['73000000-0000-4000-8000-000000000003'::uuid]
    );
    raise exception 'assigned players were incorrectly removable';
  exception when others then
    if sqlerrm not like 'Remove a player from their season team%' then
      raise;
    end if;
  end;

  begin
    perform save_season_roster_atomic(
      '72000000-0000-4000-8000-000000000001'::uuid,
      array['73000000-0000-4000-8000-000000000004'::uuid]
    );
    raise exception 'nonmember was incorrectly selectable';
  exception when others then
    if sqlerrm not like 'Every selected player must be active%' then
      raise;
    end if;
  end;
end;
$$;

update public.league_players set status = 'inactive'
where league_id = '71000000-0000-4000-8000-000000000001'
  and pool_player_id = '73000000-0000-4000-8000-000000000003';

do $$
begin
  begin
    perform save_season_roster_atomic(
      '72000000-0000-4000-8000-000000000001'::uuid,
      array[
        '73000000-0000-4000-8000-000000000001'::uuid,
        '73000000-0000-4000-8000-000000000002'::uuid,
        '73000000-0000-4000-8000-000000000003'::uuid
      ]
    );
    raise exception 'inactive league member was incorrectly selectable';
  exception when others then
    if sqlerrm not like 'Every selected player must be active%' then
      raise;
    end if;
  end;
end;
$$;

select save_season_roster_atomic(
  '72000000-0000-4000-8000-000000000001'::uuid,
  array[
    '73000000-0000-4000-8000-000000000001'::uuid,
    '73000000-0000-4000-8000-000000000002'::uuid
  ]
);

do $$
begin
  if (select count(*) from public.season_roster
      where season_id = '72000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'unselected player remained in the season';
  end if;

  begin
    perform save_selected_season_teams_atomic(
      '72000000-0000-4000-8000-000000000001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'name', 'Invalid team',
          'color', '#0000ff',
          'poolPlayerIds', jsonb_build_array(
            '73000000-0000-4000-8000-000000000001',
            '73000000-0000-4000-8000-000000000003'
          )
        )
      )
    );
    raise exception 'unselected player was incorrectly assigned to a team';
  exception when others then
    if sqlerrm not like 'Select every team player for this season%' then
      raise;
    end if;
  end;
end;
$$;

rollback;
