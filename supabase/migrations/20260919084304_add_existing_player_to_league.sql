-- Link an existing shared player identity to another league while keeping the
-- new league's rating state and initial history independent.
create or replace function public.add_existing_player_to_league(
  p_league_id uuid,
  p_pool_player_id uuid,
  p_initial_rating double precision default 1500
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_sequence integer;
begin
  if p_initial_rating is null
    or not (p_initial_rating between 800 and 2500) then
    raise exception 'Starting rating must be between 800 and 2500';
  end if;

  if not exists (
    select 1
    from public.player_pool
    where id = p_pool_player_id
  ) then
    raise exception 'Shared player % was not found', p_pool_player_id;
  end if;

  if exists (
    select 1
    from public.league_players
    where league_id = p_league_id
      and pool_player_id = p_pool_player_id
  ) then
    raise exception 'Player is already in this league';
  end if;

  -- Lock and advance the league rating revision so a concurrent rating rebuild
  -- cannot commit using a roster snapshot from before this membership existed.
  update public.rating_state
  set revision = revision + 1
  where league_id = p_league_id;

  if not found then
    raise exception 'League % was not found', p_league_id;
  end if;

  select coalesce(max(sequence), -1) + 1
  into next_sequence
  from public.rating_history
  where league_id = p_league_id;

  p_initial_rating := round(p_initial_rating);

  insert into public.league_players (
    league_id,
    pool_player_id,
    status,
    rating,
    rating_deviation,
    volatility,
    initial_rating
  ) values (
    p_league_id,
    p_pool_player_id,
    'active',
    p_initial_rating,
    350,
    0.06,
    p_initial_rating
  );

  insert into public.rating_history (
    league_id,
    pool_player_id,
    match_id,
    rating,
    rating_deviation,
    sequence,
    recorded_at
  ) values (
    p_league_id,
    p_pool_player_id,
    null,
    p_initial_rating,
    350,
    next_sequence,
    now()
  );
end;
$$;

revoke all on function public.add_existing_player_to_league(uuid, uuid, double precision)
  from public, anon;
grant execute on function public.add_existing_player_to_league(uuid, uuid, double precision)
  to authenticated;
