-- Historical play dates (day/month, year 2026):
-- Season 1: 9 Jul, Season 2: 16 Jul, Season 3: 23 Jul

UPDATE seasons SET starts_at = '2026-07-09 04:00:00+00' WHERE name = 'Season 1';
UPDATE seasons SET starts_at = '2026-07-16 04:00:00+00' WHERE name = 'Season 2';
UPDATE seasons SET starts_at = '2026-07-23 04:00:00+00' WHERE name = 'Season 3';

UPDATE matches m
SET result_recorded_at = timestamptz '2026-07-09 11:00:00+00' + ((ord.n) * interval '1 minute')
FROM (
  SELECT id, row_number() OVER (ORDER BY round_number, id) - 1 AS n
  FROM matches
  WHERE season_id = (SELECT id FROM seasons WHERE name = 'Season 1')
    AND status IN ('completed', 'forfeit')
) ord
WHERE m.id = ord.id;

UPDATE matches m
SET result_recorded_at = timestamptz '2026-07-16 11:00:00+00' + ((ord.n) * interval '1 minute')
FROM (
  SELECT id, row_number() OVER (ORDER BY round_number, id) - 1 AS n
  FROM matches
  WHERE season_id = (SELECT id FROM seasons WHERE name = 'Season 2')
    AND status IN ('completed', 'forfeit')
) ord
WHERE m.id = ord.id;

UPDATE matches m
SET result_recorded_at = timestamptz '2026-07-23 11:00:00+00' + ((ord.n) * interval '1 minute')
FROM (
  SELECT id, row_number() OVER (ORDER BY round_number, id) - 1 AS n
  FROM matches
  WHERE season_id = (SELECT id FROM seasons WHERE name = 'Season 3')
    AND status IN ('completed', 'forfeit')
) ord
WHERE m.id = ord.id;
