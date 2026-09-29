-- League creation may stop after the league and first season. Players, teams,
-- and matches can be added later from Setup without weakening the full-setup
-- validation used by the existing three-step wizard.
create or replace function public.create_league_atomic(
  p_league_id uuid,
  p_slug text,
  p_name text,
  p_season_id uuid,
  p_season_name text,
  p_players jsonb,
  p_teams jsonb,
  p_matches jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  player_payload jsonb;
  player_id uuid;
  player_name text;
  initial_rating double precision;
  is_new boolean;
  player_sequence integer := 0;
begin
  if btrim(p_name) = '' or btrim(p_season_name) = '' then
    raise exception 'League and season names are required';
  end if;

  if jsonb_typeof(p_players) is distinct from 'array' then
    raise exception 'Players must be an array';
  end if;
  if jsonb_typeof(p_teams) is distinct from 'array' then
    raise exception 'Teams must be an array';
  end if;
  if jsonb_typeof(p_matches) is distinct from 'array' then
    raise exception 'Matches must be an array';
  end if;

  if jsonb_array_length(p_teams) > 0
    and jsonb_array_length(p_players) < 4 then
    raise exception 'A league with teams needs at least four players';
  end if;
  if jsonb_array_length(p_teams) = 1 then
    raise exception 'A league with teams needs at least two teams';
  end if;
  if jsonb_array_length(p_matches) > 0
    and jsonb_array_length(p_teams) = 0 then
    raise exception 'Matches cannot be created before teams';
  end if;

  insert into public.leagues (id, slug, name)
  values (p_league_id, lower(btrim(p_slug)), btrim(p_name));
  insert into public.seasons (id, league_id, name, status)
  values (p_season_id, p_league_id, btrim(p_season_name), 'active');
  insert into public.rating_state (league_id, revision)
  values (p_league_id, 0);

  for player_payload in select value from jsonb_array_elements(p_players)
  loop
    player_id := (player_payload->>'id')::uuid;
    player_name := btrim(coalesce(player_payload->>'name', ''));
    initial_rating := least(
      2500,
      greatest(800, coalesce((player_payload->>'initial_rating')::double precision, 1500))
    );
    is_new := coalesce((player_payload->>'is_new')::boolean, false);

    if is_new then
      if player_name = '' then
        raise exception 'Player name cannot be empty';
      end if;
      insert into public.player_pool (
        id, name, status, rating, rating_deviation, volatility, initial_rating
      ) values (
        player_id, player_name, 'active', initial_rating, 275, 0, initial_rating
      );
    elsif not exists (
      select 1 from public.player_pool where id = player_id
    ) then
      raise exception 'Shared player % was not found', player_id;
    end if;

    insert into public.league_players (
      league_id, pool_player_id, status, rating,
      rating_deviation, volatility, initial_rating
    ) values (
      p_league_id, player_id, 'active', initial_rating, 275, 0, initial_rating
    );

    insert into public.rating_history (
      league_id, pool_player_id, match_id, rating,
      rating_deviation, sequence, recorded_at
    ) values (
      p_league_id, player_id, null, initial_rating,
      275, player_sequence, now()
    );
    player_sequence := player_sequence + 1;
  end loop;

  if jsonb_array_length(p_teams) > 0 then
    perform public.save_season_teams_atomic(p_season_id, p_teams);
  end if;
  if jsonb_array_length(p_matches) > 0 then
    perform public.create_season_matches_atomic(p_season_id, p_matches);
  end if;

  return jsonb_build_object(
    'league_id', p_league_id,
    'season_id', p_season_id,
    'slug', lower(btrim(p_slug))
  );
end;
$$;

revoke all on function public.create_league_atomic(
  uuid, text, text, uuid, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.create_league_atomic(
  uuid, text, text, uuid, text, jsonb, jsonb, jsonb
) to authenticated;

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
    275,
    0,
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
    275,
    next_sequence,
    now()
  );
end;
$$;

revoke all on function public.add_existing_player_to_league(uuid, uuid, double precision)
  from public, anon;
grant execute on function public.add_existing_player_to_league(uuid, uuid, double precision)
  to authenticated;

-- The app's seeded TrueSkill prior is 275 display points, with no Glicko volatility.
alter table public.league_players alter column rating_deviation set default 275;
alter table public.league_players alter column volatility set default 0;
alter table public.player_pool alter column rating_deviation set default 275;
alter table public.player_pool alter column volatility set default 0;

-- Invalidate concurrent replays before changing any unplayed membership/history.
update public.rating_state as state
set revision = state.revision + 1
where state.league_id in (
  select player.league_id from public.league_players as player
  where player.rating_deviation = 350 and player.rating = player.initial_rating
    and not exists (
      select 1 from public.rating_history as history
      where history.league_id = player.league_id
        and history.pool_player_id = player.pool_player_id and history.match_id is not null
    )
);

update public.league_players as player
set rating_deviation = 275, volatility = 0
where player.rating_deviation = 350 and player.rating = player.initial_rating
  and not exists (
    select 1 from public.rating_history as history
    where history.league_id = player.league_id
      and history.pool_player_id = player.pool_player_id and history.match_id is not null
  );

update public.rating_history as initial
set rating_deviation = 275
where initial.match_id is null and initial.rating_deviation = 350
  and exists (
    select 1 from public.league_players as player
    where player.league_id = initial.league_id
      and player.pool_player_id = initial.pool_player_id
      and player.rating = player.initial_rating
  )
  and not exists (
    select 1 from public.rating_history as played
    where played.league_id = initial.league_id
      and played.pool_player_id = initial.pool_player_id and played.match_id is not null
  );
