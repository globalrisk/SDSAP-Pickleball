-- Awards already record their source league. Change read APIs only: no award
-- receipt, allocation, or Season 13 prize needs to be rewritten.
DROP FUNCTION public.pickle_leaderboard();
DROP FUNCTION public.pickle_contributions(uuid);

CREATE FUNCTION public.pickle_leaderboard(p_league_id uuid)
RETURNS TABLE(id uuid,name text,status text,balance text,rank bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH earned AS (
    SELECT a.pool_player_id,sum(a.amount) AS balance
    FROM public.pickle_allocations a JOIN public.pickle_awards r ON r.season_id=a.season_id
    WHERE r.league_id=p_league_id GROUP BY a.pool_player_id
  ), members AS (
    SELECT p.id,p.name,m.status,COALESCE(e.balance,0) AS balance
    FROM public.league_players m JOIN public.player_pool p ON p.id=m.pool_player_id
    LEFT JOIN earned e ON e.pool_player_id=p.id WHERE m.league_id=p_league_id
  )
  SELECT id,name,status,balance::text,rank() OVER (ORDER BY balance DESC)
  FROM members ORDER BY balance DESC,name,id;
$$;

CREATE FUNCTION public.pickle_contributions(p_league_id uuid,p_player_id uuid)
RETURNS TABLE(season_id uuid,season_name text,league_name text,team_name text,amount text,awarded_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT a.season_id,s.name,l.name,t.name,a.amount::text,r.awarded_at
  FROM public.pickle_allocations a JOIN public.pickle_awards r ON r.season_id=a.season_id
  JOIN public.seasons s ON s.id=a.season_id JOIN public.leagues l ON l.id=r.league_id
  JOIN public.teams t ON t.id=a.team_id
  WHERE r.league_id=p_league_id AND a.pool_player_id=p_player_id
  ORDER BY r.awarded_at DESC,a.season_id;
$$;

REVOKE ALL ON FUNCTION public.pickle_leaderboard(uuid),public.pickle_contributions(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pickle_leaderboard(uuid),public.pickle_contributions(uuid,uuid) TO anon,authenticated;
COMMENT ON FUNCTION public.pickle_leaderboard(uuid) IS 'League members ranked by points earned only in the requested league.';
COMMENT ON FUNCTION public.pickle_contributions(uuid,uuid) IS 'One player''s awarded contributions from the requested league only.';
