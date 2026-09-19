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
        player_id, player_name, 'active', initial_rating, 350, 0.06, initial_rating
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
      p_league_id, player_id, 'active', initial_rating, 350, 0.06, initial_rating
    );

    insert into public.rating_history (
      league_id, pool_player_id, match_id, rating,
      rating_deviation, sequence, recorded_at
    ) values (
      p_league_id, player_id, null, initial_rating,
      350, player_sequence, now()
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
