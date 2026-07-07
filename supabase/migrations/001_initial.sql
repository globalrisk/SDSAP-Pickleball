-- Pickleball League: schema, RLS, and seed data
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team_id uuid NOT NULL REFERENCES teams(id),
  away_team_id uuid NOT NULL REFERENCES teams(id),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'forfeit')),
  home_score int,
  away_score int,
  winner_team_id uuid REFERENCES teams(id),
  round_number int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_team_id <> away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_matches_scheduled_at ON matches(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read teams" ON teams;
DROP POLICY IF EXISTS "Public write teams" ON teams;
DROP POLICY IF EXISTS "Public read players" ON players;
DROP POLICY IF EXISTS "Public write players" ON players;
DROP POLICY IF EXISTS "Public read matches" ON matches;
DROP POLICY IF EXISTS "Public write matches" ON matches;

CREATE POLICY "Public read teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Public write teams" ON teams FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read players" ON players FOR SELECT USING (true);
CREATE POLICY "Public write players" ON players FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Public read matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Public write matches" ON matches FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime for live standings updates
ALTER PUBLICATION supabase_realtime ADD TABLE matches;

-- Seed data (skip if teams already exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM teams LIMIT 1) THEN
    RAISE NOTICE 'Seed skipped: teams already exist';
    RETURN;
  END IF;

  INSERT INTO teams (id, name, color) VALUES
    ('11111111-1111-1111-1111-111111111101', 'Team Alpha',   '#ef4444'),
    ('11111111-1111-1111-1111-111111111102', 'Team Bravo',   '#f97316'),
    ('11111111-1111-1111-1111-111111111103', 'Team Charlie', '#eab308'),
    ('11111111-1111-1111-1111-111111111104', 'Team Delta',   '#22c55e'),
    ('11111111-1111-1111-1111-111111111105', 'Team Echo',    '#3b82f6'),
    ('11111111-1111-1111-1111-111111111106', 'Team Foxtrot', '#a855f7');

  INSERT INTO players (name, team_id) VALUES
    ('Player 1A', '11111111-1111-1111-1111-111111111101'),
    ('Player 1B', '11111111-1111-1111-1111-111111111101'),
    ('Player 2A', '11111111-1111-1111-1111-111111111102'),
    ('Player 2B', '11111111-1111-1111-1111-111111111102'),
    ('Player 3A', '11111111-1111-1111-1111-111111111103'),
    ('Player 3B', '11111111-1111-1111-1111-111111111103'),
    ('Player 4A', '11111111-1111-1111-1111-111111111104'),
    ('Player 4B', '11111111-1111-1111-1111-111111111104'),
    ('Player 5A', '11111111-1111-1111-1111-111111111105'),
    ('Player 5B', '11111111-1111-1111-1111-111111111105'),
    ('Player 6A', '11111111-1111-1111-1111-111111111106'),
    ('Player 6B', '11111111-1111-1111-1111-111111111106');

  -- Round robin: 5 rounds, 3 matches each (15 total)
  INSERT INTO matches (home_team_id, away_team_id, scheduled_at, round_number) VALUES
    -- Round 1
    ('11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111106', '2026-07-14 18:00:00+00', 1),
    ('11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111105', '2026-07-14 18:00:00+00', 1),
    ('11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111104', '2026-07-14 18:00:00+00', 1),
    -- Round 2
    ('11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111105', '2026-07-21 18:00:00+00', 2),
    ('11111111-1111-1111-1111-111111111106', '11111111-1111-1111-1111-111111111104', '2026-07-21 18:00:00+00', 2),
    ('11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111103', '2026-07-21 18:00:00+00', 2),
    -- Round 3
    ('11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111104', '2026-07-28 18:00:00+00', 3),
    ('11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111103', '2026-07-28 18:00:00+00', 3),
    ('11111111-1111-1111-1111-111111111106', '11111111-1111-1111-1111-111111111102', '2026-07-28 18:00:00+00', 3),
    -- Round 4
    ('11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103', '2026-08-04 18:00:00+00', 4),
    ('11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111102', '2026-08-04 18:00:00+00', 4),
    ('11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111106', '2026-08-04 18:00:00+00', 4),
    -- Round 5
    ('11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111102', '2026-08-11 18:00:00+00', 5),
    ('11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111106', '2026-08-11 18:00:00+00', 5),
    ('11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111105', '2026-08-11 18:00:00+00', 5);
END $$;
