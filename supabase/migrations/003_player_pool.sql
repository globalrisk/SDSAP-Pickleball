-- Global player pool: shared roster, assigned to season teams via players.pool_player_id

CREATE TABLE IF NOT EXISTS player_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS pool_player_id uuid REFERENCES player_pool(id);

-- Backfill: one pool row per existing player row
DO $$
DECLARE
  player_row RECORD;
  new_pool_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM player_pool LIMIT 1) THEN
    RAISE NOTICE 'Player pool backfill skipped: pool already exists';
    RETURN;
  END IF;

  FOR player_row IN SELECT id, name FROM players WHERE pool_player_id IS NULL LOOP
    INSERT INTO player_pool (name) VALUES (player_row.name) RETURNING id INTO new_pool_id;
    UPDATE players SET pool_player_id = new_pool_id WHERE id = player_row.id;
  END LOOP;
END $$;

ALTER TABLE players ALTER COLUMN pool_player_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_players_pool_player_id ON players(pool_player_id);

ALTER TABLE player_pool ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read player_pool" ON player_pool;
DROP POLICY IF EXISTS "Public write player_pool" ON player_pool;

CREATE POLICY "Public read player_pool" ON player_pool FOR SELECT USING (true);
CREATE POLICY "Public write player_pool" ON player_pool FOR ALL USING (true) WITH CHECK (true);
