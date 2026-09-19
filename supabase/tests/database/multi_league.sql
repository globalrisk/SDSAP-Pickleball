-- Integration checks for league isolation, shared identities, and admin-only writes.
begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"app_metadata":{"role":"admin"}}',
  true
);

select create_league_atomic(
  '61000000-0000-4000-8000-000000000001'::uuid,
  'integration-alpha',
  'Integration Alpha',
  '62000000-0000-4000-8000-000000000001'::uuid,
  'Season 1',
  jsonb_build_array(
    jsonb_build_object('id','63000000-0000-4000-8000-000000000001','name','Shared A','is_new',true,'initial_rating',1500),
    jsonb_build_object('id','63000000-0000-4000-8000-000000000002','name','Shared B','is_new',true,'initial_rating',1500),
    jsonb_build_object('id','63000000-0000-4000-8000-000000000003','name','Shared C','is_new',true,'initial_rating',1500),
    jsonb_build_object('id','63000000-0000-4000-8000-000000000004','name','Shared D','is_new',true,'initial_rating',1500)
  ),
  jsonb_build_array(
    jsonb_build_object('id','64000000-0000-4000-8000-000000000001','name','Alpha One','color','#008000','poolPlayerIds',jsonb_build_array('63000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000002')),
    jsonb_build_object('id','64000000-0000-4000-8000-000000000002','name','Alpha Two','color','#0000ff','poolPlayerIds',jsonb_build_array('63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000004'))
  ),
  jsonb_build_array(
    jsonb_build_object('home_team_id','64000000-0000-4000-8000-000000000001','away_team_id','64000000-0000-4000-8000-000000000002','round_number',1)
  )
);

select create_league_atomic(
  '61000000-0000-4000-8000-000000000002'::uuid,
  'integration-beta',
  'Integration Beta',
  '62000000-0000-4000-8000-000000000002'::uuid,
  'Season 1',
  jsonb_build_array(
    jsonb_build_object('id','63000000-0000-4000-8000-000000000001','name','Shared A','is_new',false,'initial_rating',1500),
    jsonb_build_object('id','63000000-0000-4000-8000-000000000002','name','Shared B','is_new',false,'initial_rating',1500),
    jsonb_build_object('id','63000000-0000-4000-8000-000000000003','name','Shared C','is_new',false,'initial_rating',1500),
    jsonb_build_object('id','63000000-0000-4000-8000-000000000004','name','Shared D','is_new',false,'initial_rating',1500)
  ),
  jsonb_build_array(
    jsonb_build_object('id','64000000-0000-4000-8000-000000000003','name','Beta One','color','#008000','poolPlayerIds',jsonb_build_array('63000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003')),
    jsonb_build_object('id','64000000-0000-4000-8000-000000000004','name','Beta Two','color','#0000ff','poolPlayerIds',jsonb_build_array('63000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000004'))
  ),
  jsonb_build_array(
    jsonb_build_object('home_team_id','64000000-0000-4000-8000-000000000003','away_team_id','64000000-0000-4000-8000-000000000004','round_number',1)
  )
);

select create_league_atomic(
  '61000000-0000-4000-8000-000000000003'::uuid,
  'integration-gamma',
  'Integration Gamma',
  '62000000-0000-4000-8000-000000000003'::uuid,
  'Season 1',
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
);

select add_existing_player_to_league(
  '61000000-0000-4000-8000-000000000003'::uuid,
  '63000000-0000-4000-8000-000000000001'::uuid,
  1600
);

update league_players
set rating = 1700
where league_id = '61000000-0000-4000-8000-000000000001'
  and pool_player_id = '63000000-0000-4000-8000-000000000001';

update player_pool
set name = 'Shared A Renamed'
where id = '63000000-0000-4000-8000-000000000001';

do $$
begin
  if (
    select count(*) from seasons
    where status = 'active'
      and league_id in (
        '61000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000002'
      )
  ) <> 2 then
    raise exception 'two leagues could not run active seasons simultaneously';
  end if;

  if (
    select count(*) from league_players
    where pool_player_id = '63000000-0000-4000-8000-000000000001'
      and league_id in (
        '61000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000002'
      )
  ) <> 2 then
    raise exception 'shared player identity is not linked to both leagues';
  end if;

  if (
    select count(distinct rating) from league_players
    where pool_player_id = '63000000-0000-4000-8000-000000000001'
      and league_id in (
        '61000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000002'
      )
  ) <> 2 then
    raise exception 'ratings are not independent between leagues';
  end if;

  if exists (
    select 1 from players
    where pool_player_id = '63000000-0000-4000-8000-000000000001'
      and name <> 'Shared A Renamed'
  ) then
    raise exception 'shared player rename did not propagate to every roster';
  end if;

  if not exists (
    select 1
    from league_players
    where league_id = '61000000-0000-4000-8000-000000000003'
      and pool_player_id = '63000000-0000-4000-8000-000000000001'
      and status = 'active'
      and rating = 1600
      and initial_rating = 1600
  ) then
    raise exception 'existing player was not linked with an independent league rating';
  end if;

  if not exists (
    select 1
    from rating_history
    where league_id = '61000000-0000-4000-8000-000000000003'
      and pool_player_id = '63000000-0000-4000-8000-000000000001'
      and match_id is null
      and rating = 1600
      and sequence = 0
  ) then
    raise exception 'existing player initial rating history was not created';
  end if;

  if (
    select revision
    from rating_state
    where league_id = '61000000-0000-4000-8000-000000000003'
  ) <> 1 then
    raise exception 'league rating revision was not advanced';
  end if;

  if not exists (
    select 1
    from seasons
    where id = '62000000-0000-4000-8000-000000000003'
      and league_id = '61000000-0000-4000-8000-000000000003'
      and status = 'active'
  ) then
    raise exception 'deferred setup did not create the first active season';
  end if;
end;
$$;

set local role anon;
select set_config('request.jwt.claims', '{}', true);

do $$
begin
  begin
    update leagues
    set name = 'Public write should fail'
    where id = '61000000-0000-4000-8000-000000000001';
    raise exception 'anonymous league update was accepted';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform add_existing_player_to_league(
      '61000000-0000-4000-8000-000000000003'::uuid,
      '63000000-0000-4000-8000-000000000002'::uuid,
      1500
    );
    raise exception 'anonymous shared-player link was accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;
