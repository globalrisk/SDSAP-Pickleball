-- Supporting indexes for the composite roster and fixture foreign keys added
-- by migration 016. PostgreSQL does not create indexes on referencing columns.

CREATE INDEX IF NOT EXISTS idx_players_team_season
  ON public.players (team_id, season_id);

CREATE INDEX IF NOT EXISTS idx_matches_home_team_season
  ON public.matches (home_team_id, season_id);

CREATE INDEX IF NOT EXISTS idx_matches_away_team_season
  ON public.matches (away_team_id, season_id);
