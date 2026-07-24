-- Per-match rating snapshots for player profile charts

CREATE TABLE IF NOT EXISTS rating_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_player_id uuid NOT NULL REFERENCES player_pool(id) ON DELETE CASCADE,
  match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  rating double precision NOT NULL,
  rating_deviation double precision NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  sequence integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rating_history_player_seq
  ON rating_history (pool_player_id, sequence);

ALTER TABLE rating_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read rating_history" ON rating_history;
DROP POLICY IF EXISTS "Public write rating_history" ON rating_history;

CREATE POLICY "Public read rating_history" ON rating_history FOR SELECT USING (true);
CREATE POLICY "Public write rating_history" ON rating_history FOR ALL USING (true) WITH CHECK (true);
