-- Harden Team Duel privileges inherited from project-wide default privileges,
-- and keep the new schema clear of Supabase database-linter findings.

CREATE INDEX IF NOT EXISTS team_duel_events_squad_a_idx
  ON public.team_duel_events (squad_a_id);
CREATE INDEX IF NOT EXISTS team_duel_events_squad_b_idx
  ON public.team_duel_events (squad_b_id);

REVOKE EXECUTE ON FUNCTION public.save_team_duel_squad_atomic(uuid, text, uuid[], integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_team_duel_squad_archived_atomic(uuid, boolean, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_team_duel_draft_atomic(uuid, date, text, uuid, uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_team_duel_draft_atomic(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_team_duel_event_atomic(uuid, integer, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_team_duel_match_atomic(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.return_team_duel_match_to_queue_atomic(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_team_duel_result_atomic(uuid, integer, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_team_duel_tiebreak_atomic(uuid, integer, integer, integer, integer, integer) FROM anon;

DROP POLICY IF EXISTS "Admin access team duel squads" ON public.team_duel_squads;
CREATE POLICY "Admin access team duel squads"
  ON public.team_duel_squads FOR ALL TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Admin access team duel squad members" ON public.team_duel_squad_members;
CREATE POLICY "Admin access team duel squad members"
  ON public.team_duel_squad_members FOR ALL TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Public read visible team duel events" ON public.team_duel_events;
DROP POLICY IF EXISTS "Admin access team duel events" ON public.team_duel_events;
CREATE POLICY "Anonymous read visible team duel events"
  ON public.team_duel_events FOR SELECT TO anon
  USING (status <> 'draft');
CREATE POLICY "Authenticated read team duel events"
  ON public.team_duel_events FOR SELECT TO authenticated
  USING (
    status <> 'draft'
    OR ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  );
CREATE POLICY "Admin insert team duel events"
  ON public.team_duel_events FOR INSERT TO authenticated
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin update team duel events"
  ON public.team_duel_events FOR UPDATE TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin delete team duel events"
  ON public.team_duel_events FOR DELETE TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Public read visible team duel event players" ON public.team_duel_event_players;
DROP POLICY IF EXISTS "Admin access team duel event players" ON public.team_duel_event_players;
CREATE POLICY "Anonymous read visible team duel event players"
  ON public.team_duel_event_players FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.team_duel_events event
    WHERE event.id = event_id AND event.status <> 'draft'
  ));
CREATE POLICY "Authenticated read team duel event players"
  ON public.team_duel_event_players FOR SELECT TO authenticated
  USING (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.team_duel_events event
      WHERE event.id = event_id AND event.status <> 'draft'
    )
  );
CREATE POLICY "Admin insert team duel event players"
  ON public.team_duel_event_players FOR INSERT TO authenticated
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin update team duel event players"
  ON public.team_duel_event_players FOR UPDATE TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin delete team duel event players"
  ON public.team_duel_event_players FOR DELETE TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Public read visible team duel matches" ON public.team_duel_matches;
DROP POLICY IF EXISTS "Admin access team duel matches" ON public.team_duel_matches;
CREATE POLICY "Anonymous read visible team duel matches"
  ON public.team_duel_matches FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.team_duel_events event
    WHERE event.id = event_id AND event.status <> 'draft'
  ));
CREATE POLICY "Authenticated read team duel matches"
  ON public.team_duel_matches FOR SELECT TO authenticated
  USING (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.team_duel_events event
      WHERE event.id = event_id AND event.status <> 'draft'
    )
  );
CREATE POLICY "Admin insert team duel matches"
  ON public.team_duel_matches FOR INSERT TO authenticated
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin update team duel matches"
  ON public.team_duel_matches FOR UPDATE TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
CREATE POLICY "Admin delete team duel matches"
  ON public.team_duel_matches FOR DELETE TO authenticated
  USING (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
