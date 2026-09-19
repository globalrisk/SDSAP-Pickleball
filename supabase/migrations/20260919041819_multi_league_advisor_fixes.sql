-- Tighten helper execution and split write policies so authenticated reads use
-- only the public SELECT policy. Wrapping auth.jwt() in SELECT lets Postgres
-- evaluate the claim once per statement rather than once per row.

ALTER FUNCTION public.sync_shared_player_name() SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.sync_shared_player_name() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target_table text;
  admin_check text := '((select auth.jwt()) -> ''app_metadata'' ->> ''role'') = ''admin''';
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'leagues', 'seasons', 'teams', 'players', 'matches', 'player_pool',
    'league_players', 'rating_history', 'rating_state',
    'rotation_events', 'rotation_players', 'rotation_matches'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin write ' || target_table, target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin insert ' || target_table, target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin update ' || target_table, target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin delete ' || target_table, target_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
      'Admin insert ' || target_table,
      target_table,
      admin_check
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
      'Admin update ' || target_table,
      target_table,
      admin_check,
      admin_check
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
      'Admin delete ' || target_table,
      target_table,
      admin_check
    );
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS matches_winner_team_idx
  ON public.matches (winner_team_id);
CREATE INDEX IF NOT EXISTS rating_history_match_idx
  ON public.rating_history (match_id);
CREATE INDEX IF NOT EXISTS rating_history_pool_player_idx
  ON public.rating_history (pool_player_id);
