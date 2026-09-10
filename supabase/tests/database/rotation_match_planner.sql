-- Integration checks for the standalone rotation planner.
-- Every fixture is rolled back, so the singleton live event is not changed.

begin;

-- Match the browser/mobile Data API execution context. This catches role-specific
-- guards such as Supabase safeupdate, which do not affect the database owner.
set local role anon;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['rotation_events', 'rotation_players', 'rotation_matches']
  loop
    if not has_table_privilege('anon', 'public.' || v_table, 'select,insert,update,delete') then
      raise exception 'anon grants are incomplete for %', v_table;
    end if;
    if not exists (
      select 1
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and pg_class.relname = v_table
        and pg_class.relrowsecurity
    ) then
      raise exception 'RLS is not enabled for %', v_table;
    end if;
  end loop;
end;
$$;

select replace_rotation_event_atomic(
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Database verification',
  2,
  2,
  12345,
  jsonb_build_array(
    jsonb_build_object('id','20000000-0000-0000-0000-000000000001','name','A','display_order',1),
    jsonb_build_object('id','20000000-0000-0000-0000-000000000002','name','B','display_order',2),
    jsonb_build_object('id','20000000-0000-0000-0000-000000000003','name','C','display_order',3),
    jsonb_build_object('id','20000000-0000-0000-0000-000000000004','name','D','display_order',4),
    jsonb_build_object('id','20000000-0000-0000-0000-000000000005','name','E','display_order',5),
    jsonb_build_object('id','20000000-0000-0000-0000-000000000006','name','F','display_order',6),
    jsonb_build_object('id','20000000-0000-0000-0000-000000000007','name','G','display_order',7),
    jsonb_build_object('id','20000000-0000-0000-0000-000000000008','name','H','display_order',8)
  ),
  jsonb_build_array(
    jsonb_build_object('id','30000000-0000-0000-0000-000000000001','sequence_number',1,'team_a_player_1_id','20000000-0000-0000-0000-000000000001','team_a_player_2_id','20000000-0000-0000-0000-000000000002','team_b_player_1_id','20000000-0000-0000-0000-000000000003','team_b_player_2_id','20000000-0000-0000-0000-000000000004'),
    jsonb_build_object('id','30000000-0000-0000-0000-000000000002','sequence_number',2,'team_a_player_1_id','20000000-0000-0000-0000-000000000005','team_a_player_2_id','20000000-0000-0000-0000-000000000006','team_b_player_1_id','20000000-0000-0000-0000-000000000007','team_b_player_2_id','20000000-0000-0000-0000-000000000008'),
    jsonb_build_object('id','30000000-0000-0000-0000-000000000003','sequence_number',3,'team_a_player_1_id','20000000-0000-0000-0000-000000000001','team_a_player_2_id','20000000-0000-0000-0000-000000000005','team_b_player_1_id','20000000-0000-0000-0000-000000000003','team_b_player_2_id','20000000-0000-0000-0000-000000000007'),
    jsonb_build_object('id','30000000-0000-0000-0000-000000000004','sequence_number',4,'team_a_player_1_id','20000000-0000-0000-0000-000000000002','team_a_player_2_id','20000000-0000-0000-0000-000000000006','team_b_player_1_id','20000000-0000-0000-0000-000000000004','team_b_player_2_id','20000000-0000-0000-0000-000000000008')
  )
);

do $$
begin
  if (select count(*) from rotation_players) <> 8 then
    raise exception 'schedule did not create eight players';
  end if;
  if (select count(*) from rotation_matches) <> 4 then
    raise exception 'schedule did not create four matches';
  end if;
end;
$$;

-- The save RPC must reject repeated partnerships even if appearance counts match.
do $$
begin
  begin
    perform replace_rotation_event_atomic(
      '11000000-0000-0000-0000-000000000001'::uuid,
      'Invalid schedule',
      2,
      1,
      1,
      jsonb_build_array(
        jsonb_build_object('id','21000000-0000-0000-0000-000000000001','name','A','display_order',1),
        jsonb_build_object('id','21000000-0000-0000-0000-000000000002','name','B','display_order',2),
        jsonb_build_object('id','21000000-0000-0000-0000-000000000003','name','C','display_order',3),
        jsonb_build_object('id','21000000-0000-0000-0000-000000000004','name','D','display_order',4)
      ),
      jsonb_build_array(
        jsonb_build_object('id','31000000-0000-0000-0000-000000000001','sequence_number',1,'team_a_player_1_id','21000000-0000-0000-0000-000000000001','team_a_player_2_id','21000000-0000-0000-0000-000000000002','team_b_player_1_id','21000000-0000-0000-0000-000000000003','team_b_player_2_id','21000000-0000-0000-0000-000000000004'),
        jsonb_build_object('id','31000000-0000-0000-0000-000000000002','sequence_number',2,'team_a_player_1_id','21000000-0000-0000-0000-000000000001','team_a_player_2_id','21000000-0000-0000-0000-000000000002','team_b_player_1_id','21000000-0000-0000-0000-000000000003','team_b_player_2_id','21000000-0000-0000-0000-000000000004')
      )
    );
    raise exception 'repeated partners were accepted';
  exception
    when others then
      if sqlerrm = 'repeated partners were accepted' then raise; end if;
      if position('Partners cannot repeat' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

select start_rotation_match_atomic('30000000-0000-0000-0000-000000000001', 1, 0);

-- An occupied court must reject a second match.
do $$
begin
  begin
    perform start_rotation_match_atomic('30000000-0000-0000-0000-000000000002', 1, 0);
    raise exception 'occupied court was accepted';
  exception
    when others then
      if sqlerrm = 'occupied court was accepted' then raise; end if;
      if position('Court is already occupied' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- A different court still cannot schedule a player who is already active.
do $$
begin
  begin
    perform start_rotation_match_atomic('30000000-0000-0000-0000-000000000003', 2, 0);
    raise exception 'active player conflict was accepted';
  exception
    when others then
      if sqlerrm = 'active player conflict was accepted' then raise; end if;
      if position('already playing' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

select save_rotation_match_result_atomic('30000000-0000-0000-0000-000000000001', 11, 9, 1);

-- A stale device must not overwrite the saved score.
do $$
begin
  begin
    perform save_rotation_match_result_atomic('30000000-0000-0000-0000-000000000001', 12, 10, 1);
    raise exception 'stale score revision was accepted';
  exception
    when serialization_failure then null;
  end;
end;
$$;

select save_rotation_match_result_atomic('30000000-0000-0000-0000-000000000001', 12, 10, 2);

-- The roster and matchup identities are locked after the first match starts.
do $$
begin
  begin
    delete from rotation_players where id = '20000000-0000-0000-0000-000000000008';
    raise exception 'active roster deletion was accepted';
  exception
    when others then
      if sqlerrm = 'active roster deletion was accepted' then raise; end if;
      if position('roster is locked' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

select reset_rotation_event_atomic('10000000-0000-0000-0000-000000000001');

do $$
begin
  if exists (select 1 from rotation_players) or exists (select 1 from rotation_matches) then
    raise exception 'rotation cascade delete left child rows';
  end if;
end;
$$;

rollback;
