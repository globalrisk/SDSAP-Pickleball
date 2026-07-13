-- Multi-season support: seasons table and season_id on teams/matches

CREATE TABLE IF NOT EXISTS seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_one_active
  ON seasons (status)
  WHERE status = 'active';

ALTER TABLE teams ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES seasons(id) ON DELETE CASCADE;

-- Backfill existing data into Season 1
DO $$
DECLARE
  season1_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM seasons LIMIT 1) THEN
    RAISE NOTICE 'Season backfill skipped: seasons already exist';
    RETURN;
  END IF;

  INSERT INTO seasons (id, name, status, starts_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Season 1', 'active', now())
  RETURNING id INTO season1_id;

  UPDATE teams SET season_id = season1_id WHERE season_id IS NULL;
  UPDATE matches SET season_id = season1_id WHERE season_id IS NULL;
END $$;

ALTER TABLE teams ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE matches ALTER COLUMN season_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_teams_season_id ON teams(season_id);
CREATE INDEX IF NOT EXISTS idx_matches_season_id ON matches(season_id);

ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read seasons" ON seasons;
DROP POLICY IF EXISTS "Public write seasons" ON seasons;

CREATE POLICY "Public read seasons" ON seasons FOR SELECT USING (true);
CREATE POLICY "Public write seasons" ON seasons FOR ALL USING (true) WITH CHECK (true);
