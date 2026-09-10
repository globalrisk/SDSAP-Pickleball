alter table public.rotation_players
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.protect_active_rotation_event()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status <> 'draft'
    and current_setting('app.rotation_reset', true) is distinct from 'allowed'
  then
    raise exception 'An active rotation event must be reset through the reset action';
  end if;
  return old;
end;
$$;

create or replace function public.protect_active_rotation_roster()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  v_event_id := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  if current_setting('app.rotation_reset', true) is distinct from 'allowed'
    and exists (
      select 1 from public.rotation_events
      where id = v_event_id and status <> 'draft'
    )
  then
    raise exception 'The player roster is locked after play begins';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.protect_active_rotation_matchup()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_id uuid;
  v_schedule_changed boolean := tg_op <> 'UPDATE';
begin
  v_event_id := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  if tg_op = 'UPDATE' then
    v_schedule_changed :=
      new.event_id is distinct from old.event_id or
      new.sequence_number is distinct from old.sequence_number or
      new.team_a_player_1_id is distinct from old.team_a_player_1_id or
      new.team_a_player_2_id is distinct from old.team_a_player_2_id or
      new.team_b_player_1_id is distinct from old.team_b_player_1_id or
      new.team_b_player_2_id is distinct from old.team_b_player_2_id;
  end if;

  if v_schedule_changed
    and current_setting('app.rotation_reset', true) is distinct from 'allowed'
    and exists (
      select 1 from public.rotation_events
      where id = v_event_id and status <> 'draft'
    )
  then
    raise exception 'The match schedule is locked after play begins';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_active_rotation_event_trigger on public.rotation_events;
create trigger protect_active_rotation_event_trigger
  before delete on public.rotation_events
  for each row execute function public.protect_active_rotation_event();

drop trigger if exists protect_active_rotation_roster_trigger on public.rotation_players;
create trigger protect_active_rotation_roster_trigger
  before insert or update or delete on public.rotation_players
  for each row execute function public.protect_active_rotation_roster();

drop trigger if exists protect_active_rotation_matchup_trigger on public.rotation_matches;
create trigger protect_active_rotation_matchup_trigger
  before insert or update or delete on public.rotation_matches
  for each row execute function public.protect_active_rotation_matchup();

create or replace function public.reset_rotation_event_atomic(p_event_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('rotation-current-event'));
  perform set_config('app.rotation_reset', 'allowed', true);
  delete from public.rotation_events where id = p_event_id;
end;
$$;
