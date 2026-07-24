-- Snapshot lineups on matches so rating history stays correct if rosters change

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS home_pool_player_ids uuid[],
  ADD COLUMN IF NOT EXISTS away_pool_player_ids uuid[];

-- Backfill from current team rosters (best available historical data)
UPDATE matches m
SET
  home_pool_player_ids = (
    SELECT array_agg(p.pool_player_id ORDER BY p.id)
    FROM players p
    WHERE p.team_id = m.home_team_id
  ),
  away_pool_player_ids = (
    SELECT array_agg(p.pool_player_id ORDER BY p.id)
    FROM players p
    WHERE p.team_id = m.away_team_id
  )
WHERE home_pool_player_ids IS NULL
   OR away_pool_player_ids IS NULL;
