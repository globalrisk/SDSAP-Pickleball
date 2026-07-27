-- Active / Inactive status on global player pool (max 12 active for 6 teams)

ALTER TABLE player_pool
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'inactive';

ALTER TABLE player_pool
  DROP CONSTRAINT IF EXISTS player_pool_status_check;

ALTER TABLE player_pool
  ADD CONSTRAINT player_pool_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text]));

-- Existing roster starts active (currently 12 players)
UPDATE player_pool SET status = 'active';

CREATE OR REPLACE FUNCTION enforce_player_pool_active_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_count integer;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    SELECT count(*)::integer INTO active_count
    FROM player_pool
    WHERE status = 'active'
      AND id IS DISTINCT FROM NEW.id;

    IF active_count >= 12 THEN
      RAISE EXCEPTION 'At most 12 active players are allowed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_player_pool_active_cap ON player_pool;

CREATE TRIGGER trg_player_pool_active_cap
  BEFORE INSERT OR UPDATE OF status ON player_pool
  FOR EACH ROW
  EXECUTE FUNCTION enforce_player_pool_active_cap();
