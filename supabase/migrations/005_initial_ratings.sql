-- Persist seed ratings; recompute replays matches from initial_rating

ALTER TABLE player_pool
  ADD COLUMN IF NOT EXISTS initial_rating double precision NOT NULL DEFAULT 1500;

UPDATE player_pool SET initial_rating = 1800 WHERE name = 'A Chung';
UPDATE player_pool SET initial_rating = 1500 WHERE name = 'Đức';
UPDATE player_pool SET initial_rating = 1500 WHERE name = 'Hiệp';
UPDATE player_pool SET initial_rating = 1300 WHERE name = 'Huy';
UPDATE player_pool SET initial_rating = 1600 WHERE name = 'Lộc';
UPDATE player_pool SET initial_rating = 1400 WHERE name = 'Mạnh';
UPDATE player_pool SET initial_rating = 1700 WHERE name = 'Trọng';
UPDATE player_pool SET initial_rating = 1400 WHERE name = 'Trung';
UPDATE player_pool SET initial_rating = 1600 WHERE name = 'Trường';
UPDATE player_pool SET initial_rating = 1500 WHERE name = 'Tuấn Anh';
UPDATE player_pool SET initial_rating = 1200 WHERE name ILIKE 'Tùng núi';
UPDATE player_pool SET initial_rating = 1500 WHERE name = 'Tùng(bạn Trọng)';
