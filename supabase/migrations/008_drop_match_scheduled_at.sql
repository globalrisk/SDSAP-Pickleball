-- Matches are ordered by season + round; planned datetimes are unused.

DROP INDEX IF EXISTS idx_matches_scheduled_at;
ALTER TABLE matches DROP COLUMN IF EXISTS scheduled_at;
