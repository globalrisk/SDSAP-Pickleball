-- Keep player-only OLD/NEW fields inside a players-table branch so the shared
-- deferred trigger also runs safely for teams rows.

CREATE OR REPLACE FUNCTION public.check_team_has_two_players()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  team_id_to_check uuid;
  player_count integer;
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    team_id_to_check := COALESCE(NEW.id, OLD.id);
  ELSIF TG_OP = 'DELETE' THEN
    team_id_to_check := OLD.team_id;
  ELSE
    team_id_to_check := NEW.team_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.teams WHERE id = team_id_to_check) THEN
    SELECT count(*) INTO player_count
    FROM public.players
    WHERE team_id = team_id_to_check;

    IF player_count <> 2 THEN
      RAISE EXCEPTION 'Team % must have exactly 2 players', team_id_to_check
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'players' THEN
    IF TG_OP = 'UPDATE' AND OLD.team_id IS DISTINCT FROM NEW.team_id THEN
      IF EXISTS (SELECT 1 FROM public.teams WHERE id = OLD.team_id) THEN
        SELECT count(*) INTO player_count
        FROM public.players
        WHERE team_id = OLD.team_id;

        IF player_count <> 2 THEN
          RAISE EXCEPTION 'Team % must have exactly 2 players', OLD.team_id
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;
