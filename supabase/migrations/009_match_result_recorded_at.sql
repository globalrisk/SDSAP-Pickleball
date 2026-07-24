-- When a result was entered (not fixture round order).

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS result_recorded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_matches_result_recorded_at
  ON matches (season_id, result_recorded_at);

-- Backfill existing results with a stable provisional order (season start + round).
-- New recordings overwrite this with the real entry time.
UPDATE matches m
SET result_recorded_at =
  s.starts_at + (COALESCE(m.round_number, 1) * interval '1 hour')
FROM seasons s
WHERE m.season_id = s.id
  AND m.status IN ('completed', 'forfeit')
  AND m.result_recorded_at IS NULL;
