-- Remove the hard 12-active player cap

DROP TRIGGER IF EXISTS trg_player_pool_active_cap ON player_pool;
DROP FUNCTION IF EXISTS enforce_player_pool_active_cap();
