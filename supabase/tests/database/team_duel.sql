-- Integration checks for the standalone ranked-squad Team Duel format.
-- Every fixture is rolled back.

begin;

set local role authenticated;
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'team_duel_squads', 'team_duel_squad_members', 'team_duel_events',
    'team_duel_event_players', 'team_duel_matches'
  ] loop
    if not has_table_privilege('authenticated', 'public.' || v_table, 'select,insert,update,delete') then
      raise exception 'authenticated grants are incomplete for %', v_table;
    end if;
    if not exists (
      select 1 from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public' and pg_class.relname = v_table
        and pg_class.relrowsecurity
    ) then
      raise exception 'RLS is not enabled for %', v_table;
    end if;
  end loop;
end;
$$;

insert into player_pool (id, name, status)
select
  ('71000000-0000-4000-8000-' || lpad(player_number::text, 12, '0'))::uuid,
  'Duel Player ' || player_number,
  'active'
from generate_series(1, 12) as player_number;

select save_team_duel_squad_atomic(
  '72000000-0000-4000-8000-000000000001', 'Alpha',
  array[
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000004'
  ]::uuid[], 0
);
select save_team_duel_squad_atomic(
  '72000000-0000-4000-8000-000000000002', 'Bravo',
  array[
    '71000000-0000-4000-8000-000000000005',
    '71000000-0000-4000-8000-000000000006',
    '71000000-0000-4000-8000-000000000007',
    '71000000-0000-4000-8000-000000000008'
  ]::uuid[], 0
);

do $$
begin
  begin
    perform save_team_duel_squad_atomic(
      '72000000-0000-4000-8000-000000000003', 'Invalid',
      array[
        '71000000-0000-4000-8000-000000000009',
        '71000000-0000-4000-8000-000000000009',
        '71000000-0000-4000-8000-000000000010',
        '71000000-0000-4000-8000-000000000011'
      ]::uuid[], 0
    );
    raise exception 'duplicate squad players were accepted';
  exception when others then
    if sqlerrm = 'duplicate squad players were accepted' then raise; end if;
    if position('unique' in lower(sqlerrm)) = 0 then raise; end if;
  end;
end;
$$;

update player_pool set status = 'inactive'
where id = '71000000-0000-4000-8000-000000000012';
do $$
begin
  begin
    perform save_team_duel_squad_atomic(
      '72000000-0000-4000-8000-000000000003', 'Inactive member',
      array[
        '71000000-0000-4000-8000-000000000009',
        '71000000-0000-4000-8000-000000000010',
        '71000000-0000-4000-8000-000000000011',
        '71000000-0000-4000-8000-000000000012'
      ]::uuid[], 0
    );
    raise exception 'inactive squad player was accepted';
  exception when others then
    if sqlerrm = 'inactive squad player was accepted' then raise; end if;
    if position('active registered player' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;
update player_pool set status = 'active'
where id = '71000000-0000-4000-8000-000000000012';

select save_team_duel_draft_atomic(
  '73000000-0000-4000-8000-000000000001', date '2026-09-20', null,
  '72000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002',
  2, 0
);

select activate_team_duel_event_atomic(
  '73000000-0000-4000-8000-000000000001', 0,
  jsonb_build_array(
    jsonb_build_object('round_number',1,'sequence_number',1,'rank_1',1,'rank_2',4),
    jsonb_build_object('round_number',1,'sequence_number',2,'rank_1',2,'rank_2',3),
    jsonb_build_object('round_number',2,'sequence_number',3,'rank_1',1,'rank_2',3),
    jsonb_build_object('round_number',2,'sequence_number',4,'rank_1',4,'rank_2',2),
    jsonb_build_object('round_number',3,'sequence_number',5,'rank_1',1,'rank_2',2),
    jsonb_build_object('round_number',3,'sequence_number',6,'rank_1',3,'rank_2',4)
  )
);

do $$
begin
  if (select count(*) from team_duel_event_players where event_id = '73000000-0000-4000-8000-000000000001') <> 8 then
    raise exception 'activation did not snapshot eight players';
  end if;
  if exists (
    select 1 from team_duel_matches
    where event_id = '73000000-0000-4000-8000-000000000001'
      and kind = 'standard'
      and (
        least(team_a_rank_1, team_a_rank_2) <> least(team_b_rank_1, team_b_rank_2)
        or greatest(team_a_rank_1, team_a_rank_2) <> greatest(team_b_rank_1, team_b_rank_2)
      )
  ) then raise exception 'a standard matchup is not rank mirrored'; end if;
end;
$$;

-- Drafts can coexist, but a second event cannot become live.
select save_team_duel_draft_atomic(
  '73000000-0000-4000-8000-000000000002', date '2026-09-21', 'Second duel',
  '72000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002', 1, 0
);
do $$
begin
  begin
    perform activate_team_duel_event_atomic(
      '73000000-0000-4000-8000-000000000002', 0,
      jsonb_build_array(
        jsonb_build_object('round_number',1,'sequence_number',1,'rank_1',1,'rank_2',4),
        jsonb_build_object('round_number',1,'sequence_number',2,'rank_1',2,'rank_2',3),
        jsonb_build_object('round_number',2,'sequence_number',3,'rank_1',1,'rank_2',3),
        jsonb_build_object('round_number',2,'sequence_number',4,'rank_1',4,'rank_2',2),
        jsonb_build_object('round_number',3,'sequence_number',5,'rank_1',1,'rank_2',2),
        jsonb_build_object('round_number',3,'sequence_number',6,'rank_1',3,'rank_2',4)
      )
    );
    raise exception 'a second live duel was accepted';
  exception when others then
    if sqlerrm = 'a second live duel was accepted' then raise; end if;
    if position('already live' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- Historical snapshots do not follow later squad or identity renames.
select save_team_duel_squad_atomic(
  '72000000-0000-4000-8000-000000000001', 'Alpha Renamed',
  array[
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003',
    '71000000-0000-4000-8000-000000000004'
  ]::uuid[], 0
);
update player_pool set name = 'Renamed Player' where id = '71000000-0000-4000-8000-000000000001';
do $$
begin
  if (select squad_a_name from team_duel_events where id = '73000000-0000-4000-8000-000000000001') <> 'Alpha' then
    raise exception 'event squad snapshot changed after rename';
  end if;
  if (select display_name from team_duel_event_players where event_id = '73000000-0000-4000-8000-000000000001' and side = 'a' and rank_position = 1) <> 'Duel Player 1' then
    raise exception 'event player snapshot changed after rename';
  end if;
end;
$$;

-- Court occupancy, player occupancy, score rules, and stale revisions.
select start_team_duel_match_atomic(
  (select id from team_duel_matches where event_id = '73000000-0000-4000-8000-000000000001' and sequence_number = 1), 1, 0
);
do $$
declare
  v_match_id uuid;
begin
  select id into v_match_id from team_duel_matches
  where event_id = '73000000-0000-4000-8000-000000000001' and sequence_number = 2;
  begin
    perform start_team_duel_match_atomic(v_match_id, 1, 0);
    raise exception 'occupied court was accepted';
  exception when others then
    if sqlerrm = 'occupied court was accepted' then raise; end if;
    if position('occupied' in sqlerrm) = 0 then raise; end if;
  end;

  select id into v_match_id from team_duel_matches
  where event_id = '73000000-0000-4000-8000-000000000001' and sequence_number = 3;
  begin
    perform start_team_duel_match_atomic(v_match_id, 2, 0);
    raise exception 'busy player was accepted';
  exception when others then
    if sqlerrm = 'busy player was accepted' then raise; end if;
    if position('already playing' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

do $$
declare
  v_match_id uuid;
begin
  select id into v_match_id from team_duel_matches
  where event_id = '73000000-0000-4000-8000-000000000001' and sequence_number = 1;
  begin
    perform save_team_duel_result_atomic(v_match_id, 11, 10, 1);
    raise exception 'invalid score was accepted';
  exception when others then
    if sqlerrm = 'invalid score was accepted' then raise; end if;
    if position('2-point' in sqlerrm) = 0 then raise; end if;
  end;
  perform save_team_duel_result_atomic(v_match_id, 11, 9, 1);
  begin
    perform save_team_duel_result_atomic(v_match_id, 12, 10, 1);
    raise exception 'stale completed match was accepted';
  exception when others then
    if sqlerrm = 'stale completed match was accepted' then raise; end if;
  end;
end;
$$;

-- Complete the remaining standard schedule 3-3.
do $$
declare
  v_match record;
begin
  for v_match in
    select id, sequence_number, revision from team_duel_matches
    where event_id = '73000000-0000-4000-8000-000000000001'
      and kind = 'standard' and status = 'available'
    order by sequence_number
  loop
    perform start_team_duel_match_atomic(v_match.id, 1, v_match.revision);
    if v_match.sequence_number in (2, 3) then
      perform save_team_duel_result_atomic(v_match.id, 11, 8, v_match.revision + 1);
    else
      perform save_team_duel_result_atomic(v_match.id, 8, 11, v_match.revision + 1);
    end if;
  end loop;
end;
$$;

do $$
begin
  if (select status from team_duel_events where id = '73000000-0000-4000-8000-000000000001') <> 'tiebreak_required' then
    raise exception 'a tied standard schedule did not request a tiebreak';
  end if;
end;
$$;

select create_team_duel_tiebreak_atomic(
  '73000000-0000-4000-8000-000000000001', 1, 2, 3, 4,
  (select revision from team_duel_events where id = '73000000-0000-4000-8000-000000000001')
);
select start_team_duel_match_atomic(
  (select id from team_duel_matches where event_id = '73000000-0000-4000-8000-000000000001' and kind = 'tiebreak'), 1, 0
);
select save_team_duel_result_atomic(
  (select id from team_duel_matches where event_id = '73000000-0000-4000-8000-000000000001' and kind = 'tiebreak'), 11, 7, 1
);

do $$
begin
  if (select status from team_duel_events where id = '73000000-0000-4000-8000-000000000001') <> 'completed' then
    raise exception 'the tiebreak did not complete the duel';
  end if;
  begin
    update team_duel_events set title = 'Changed' where id = '73000000-0000-4000-8000-000000000001';
    raise exception 'completed duel mutation was accepted';
  exception when others then
    if sqlerrm = 'completed duel mutation was accepted' then raise; end if;
    if position('locked' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- A squad may be reused elsewhere, but opposing squads may not overlap.
select save_team_duel_squad_atomic(
  '72000000-0000-4000-8000-000000000004', 'Overlap',
  array[
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000009',
    '71000000-0000-4000-8000-000000000010',
    '71000000-0000-4000-8000-000000000011'
  ]::uuid[], 0
);
do $$
begin
  begin
    perform save_team_duel_draft_atomic(
      '73000000-0000-4000-8000-000000000003', date '2026-09-22', null,
      '72000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000004', 1, 0
    );
    raise exception 'overlapping opponents were accepted';
  exception when others then
    if sqlerrm = 'overlapping opponents were accepted' then raise; end if;
    if position('share a player' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

-- Public users see live/completed snapshots but not drafts or reusable squads.
set local role anon;
do $$
begin
  if has_function_privilege(
    'public.save_team_duel_squad_atomic(uuid,text,uuid[],integer)',
    'execute'
  ) then
    raise exception 'anonymous users can execute Team Duel management RPCs';
  end if;
  if has_function_privilege(
    'public.delete_team_duel_history_atomic(uuid,integer)',
    'execute'
  ) then
    raise exception 'anonymous users can delete Team Duel history';
  end if;
  if has_function_privilege(
    'public.delete_team_duel_squad_atomic(uuid,integer)',
    'execute'
  ) then
    raise exception 'anonymous users can delete Team Duel squads';
  end if;
  if (
    select count(*)
    from team_duel_events
    where id in (
      '73000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000002',
      '73000000-0000-4000-8000-000000000003'
    )
  ) <> 1 then
    raise exception 'public event visibility did not hide drafts';
  end if;
  if has_table_privilege('anon', 'public.team_duel_squads', 'select') then
    raise exception 'anonymous users can read reusable squads';
  end if;
  if (select count(*) from team_duel_matches where event_id = '73000000-0000-4000-8000-000000000001') <> 7 then
    raise exception 'public match history is incomplete';
  end if;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform delete_team_duel_squad_atomic(
      '72000000-0000-4000-8000-000000000001',
      (select revision from team_duel_squads where id = '72000000-0000-4000-8000-000000000001')
    );
    raise exception 'used squad deletion was accepted';
  exception when others then
    if sqlerrm = 'used squad deletion was accepted' then raise; end if;
    if position('cannot be deleted' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform delete_team_duel_squad_atomic(
      '72000000-0000-4000-8000-000000000004',
      (select revision - 1 from team_duel_squads where id = '72000000-0000-4000-8000-000000000004')
    );
    raise exception 'stale squad deletion was accepted';
  exception when others then
    if sqlerrm = 'stale squad deletion was accepted' then raise; end if;
    if position('another device' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

select delete_team_duel_squad_atomic(
  '72000000-0000-4000-8000-000000000004',
  (select revision from team_duel_squads where id = '72000000-0000-4000-8000-000000000004')
);

do $$
begin
  if exists (
    select 1 from team_duel_squads
    where id = '72000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'unused squad was not deleted';
  end if;
  if exists (
    select 1 from team_duel_squad_members
    where squad_id = '72000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'deleted squad members remain';
  end if;
end;
$$;

do $$
begin
  begin
    perform delete_team_duel_history_atomic(
      '73000000-0000-4000-8000-000000000001',
      (select revision - 1 from team_duel_events where id = '73000000-0000-4000-8000-000000000001')
    );
    raise exception 'stale history deletion was accepted';
  exception when others then
    if sqlerrm = 'stale history deletion was accepted' then raise; end if;
    if position('another device' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

select delete_team_duel_history_atomic(
  '73000000-0000-4000-8000-000000000001',
  (select revision from team_duel_events where id = '73000000-0000-4000-8000-000000000001')
);

do $$
begin
  if exists (
    select 1 from team_duel_events
    where id = '73000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'completed history event was not deleted';
  end if;
  if exists (
    select 1 from team_duel_event_players
    where event_id = '73000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'completed history roster snapshot was not deleted';
  end if;
  if exists (
    select 1 from team_duel_matches
    where event_id = '73000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'completed history matches were not deleted';
  end if;
end;
$$;

rollback;
