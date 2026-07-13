-- Glicko-2 rating columns on global player pool

ALTER TABLE player_pool
  ADD COLUMN IF NOT EXISTS rating double precision NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS rating_deviation double precision NOT NULL DEFAULT 350,
  ADD COLUMN IF NOT EXISTS volatility double precision NOT NULL DEFAULT 0.06;
