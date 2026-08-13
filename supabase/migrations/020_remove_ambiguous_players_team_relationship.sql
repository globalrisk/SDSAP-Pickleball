-- PostgREST cannot infer teams -> players embeds when two foreign keys connect
-- the same tables. The composite relationship already enforces team membership,
-- season consistency, and ON DELETE CASCADE, so the older FK is redundant.

ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_team_id_fkey;

NOTIFY pgrst, 'reload schema';
