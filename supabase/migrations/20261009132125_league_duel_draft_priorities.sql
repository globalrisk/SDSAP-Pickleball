-- Persist the selected optimization goal without rewriting historical fixtures.
ALTER TABLE public.seasons ADD COLUMN duel_draft_priority text
  CHECK (duel_draft_priority IN ('balance', 'opponent_variety'));

-- Replace old signatures so default arguments remain unambiguous for older clients.
DROP FUNCTION public.save_league_duel_draft_atomic(uuid, jsonb, bigint, text);
DROP FUNCTION public.generate_league_duel_matches_atomic(uuid, jsonb, bigint, text);

CREATE OR REPLACE FUNCTION public.save_league_duel_draft_atomic(
  p_season_id uuid, p_squads jsonb, p_expected_rating_revision bigint, p_expected_rating_fingerprint text, p_priority text DEFAULT 'opponent_variety'
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; season_format text; snapshot jsonb; squad jsonb; ids uuid[];
  all_ids uuid[] := ARRAY[]::uuid[]; ordered_ids uuid[]; target_team uuid; player_id uuid; position integer;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
  IF p_priority IS NULL OR p_priority NOT IN ('balance', 'opponent_variety') THEN
    RAISE EXCEPTION 'Invalid Team Duel draft priority' USING ERRCODE = '23514';
  END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id = p_season_id;
  PERFORM 1 FROM public.rating_state WHERE league_id = league FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_season_setup:' || p_season_id::text, 0));
  SELECT format INTO season_format FROM public.seasons WHERE id = p_season_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND OR season_format <> 'team_duel' THEN RAISE EXCEPTION 'Select Team Duel for an active season first'; END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id) THEN RAISE EXCEPTION 'Squads are frozen after schedule generation'; END IF;
  snapshot := public.league_duel_rating_snapshot(league);
  IF (snapshot->>'revision')::bigint IS DISTINCT FROM p_expected_rating_revision
    OR snapshot->>'fingerprint' IS DISTINCT FROM p_expected_rating_fingerprint THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: League ratings changed. Refresh draft options first.' USING ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(p_squads) IS DISTINCT FROM 'array' OR jsonb_array_length(p_squads) <> 2 THEN RAISE EXCEPTION 'Exactly two squads are required'; END IF;
  FOR squad IN SELECT value FROM jsonb_array_elements(p_squads) LOOP
    SELECT array_agg(value::uuid ORDER BY ordinality) INTO ids
      FROM jsonb_array_elements_text(squad->'poolPlayerIds') WITH ORDINALITY;
    IF cardinality(ids) NOT BETWEEN 4 AND 7 OR btrim(COALESCE(squad->>'name', '')) = ''
      OR btrim(COALESCE(squad->>'color', '')) = '' THEN RAISE EXCEPTION 'Squad names, colors and 4–7 players are required'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(ids) AS selected(id)
      LEFT JOIN public.season_roster AS roster ON roster.season_id = p_season_id AND roster.pool_player_id = selected.id
      LEFT JOIN public.league_players AS member ON member.league_id = league AND member.pool_player_id = selected.id
      WHERE roster.pool_player_id IS NULL OR member.status IS DISTINCT FROM 'active') THEN RAISE EXCEPTION 'Every squad player must be selected and active in this league'; END IF;
    SELECT array_agg(pool_player_id ORDER BY rating DESC, pool_player_id) INTO ordered_ids
      FROM public.league_players WHERE league_id = league AND pool_player_id = ANY(ids);
    IF ids IS DISTINCT FROM ordered_ids THEN RAISE EXCEPTION 'Squad ranks must follow current ratings, then player ID'; END IF;
    all_ids := all_ids || ids;
  END LOOP;
  IF cardinality(all_ids) <> (SELECT count(*) FROM public.season_roster WHERE season_id = p_season_id)
    OR (SELECT count(DISTINCT id) FROM unnest(all_ids) AS id) <> cardinality(all_ids)
    OR jsonb_array_length(p_squads->0->'poolPlayerIds') <> jsonb_array_length(p_squads->1->'poolPlayerIds') THEN
    RAISE EXCEPTION 'The squads must cover the complete season roster exactly once';
  END IF;
  FOR squad IN SELECT value FROM jsonb_array_elements(p_squads) LOOP
    SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(squad->'poolPlayerIds');
    IF EXISTS (SELECT 1 FROM public.league_duel_roster_tiers(p_season_id) AS tiers
      GROUP BY tiers.tier HAVING count(*) FILTER (WHERE tiers.pool_player_id = ANY(ids)) <> count(*) / 2) THEN
      RAISE EXCEPTION 'Both squads must have equal top, middle, and bottom tier composition' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  DELETE FROM public.teams WHERE season_id = p_season_id;
  FOR squad IN SELECT value FROM jsonb_array_elements(p_squads) LOOP
    INSERT INTO public.teams(season_id, name, color) VALUES (p_season_id, btrim(squad->>'name'), squad->>'color') RETURNING id INTO target_team;
    position := 0;
    FOR player_id IN SELECT value::uuid FROM jsonb_array_elements_text(squad->'poolPlayerIds') LOOP
      position := position + 1;
      INSERT INTO public.players(season_id, team_id, pool_player_id, name, duel_rank, duel_tier)
        SELECT p_season_id, target_team, id, name, position,
          (SELECT tier FROM public.league_duel_roster_tiers(p_season_id) WHERE pool_player_id = player_id) FROM public.player_pool WHERE id = player_id;
    END LOOP;
  END LOOP;
  UPDATE public.seasons SET duel_draft_priority = p_priority, duel_schedule_mode = 'tier_matched', duel_draft_rating_revision = p_expected_rating_revision,
    duel_draft_rating_fingerprint = p_expected_rating_fingerprint WHERE id = p_season_id;
  PERFORM public.validate_league_duel_season(p_season_id);
END;
$$;

CREATE FUNCTION public.generate_league_duel_matches_atomic(
  p_season_id uuid, p_matches jsonb, p_expected_rating_revision bigint, p_expected_rating_fingerprint text, p_expected_draft_priority text DEFAULT 'opponent_variety'
)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; target public.seasons; snapshot jsonb; size integer; inserted integer; squads uuid[]; anchor uuid;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id = p_season_id;
  PERFORM 1 FROM public.rating_state WHERE league_id = league FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_season_setup:' || p_season_id::text, 0));
  SELECT * INTO target FROM public.seasons WHERE id = p_season_id AND status = 'active' AND format = 'team_duel' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active Team Duel season first'; END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id) THEN RAISE EXCEPTION 'This season already has matches'; END IF;
  snapshot := public.league_duel_rating_snapshot(league);
  IF target.duel_schedule_mode IS DISTINCT FROM 'tier_matched' OR target.duel_draft_rating_revision IS NULL
    OR target.duel_draft_rating_revision IS DISTINCT FROM (snapshot->>'revision')::bigint
    OR target.duel_draft_rating_fingerprint IS DISTINCT FROM snapshot->>'fingerprint'
    OR p_expected_rating_revision IS DISTINCT FROM (snapshot->>'revision')::bigint
    OR p_expected_rating_fingerprint IS DISTINCT FROM snapshot->>'fingerprint' THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: Refresh and save a tier-matched draft before generating fixtures.' USING ERRCODE = '40001';
  END IF;
  IF p_expected_draft_priority IS NULL OR p_expected_draft_priority NOT IN ('balance', 'opponent_variety')
    OR COALESCE(target.duel_draft_priority, 'opponent_variety') IS DISTINCT FROM p_expected_draft_priority THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: Saved draft priority changed. Refresh the fixture plan.' USING ERRCODE = '40001';
  END IF;
  PERFORM public.validate_league_duel_season(p_season_id);
  PERFORM public.validate_league_duel_draft_ratings(p_season_id);
  SELECT roster.pool_player_id INTO anchor FROM public.season_roster AS roster JOIN public.league_players AS member
    ON member.league_id = league AND member.pool_player_id = roster.pool_player_id
    WHERE roster.season_id = p_season_id ORDER BY member.rating DESC, roster.pool_player_id LIMIT 1;
  SELECT array_agg(team.id ORDER BY EXISTS(SELECT 1 FROM public.players WHERE team_id = team.id AND pool_player_id = anchor) DESC, team.id)
    INTO squads FROM public.teams AS team WHERE team.season_id = p_season_id;
  IF cardinality(squads) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Save two squads first'; END IF;
  SELECT count(*) INTO size FROM public.players WHERE team_id = squads[1];
  IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_matches) <> size * (size - 1) / 2 THEN
    RAISE EXCEPTION 'A complete Team Duel fixture plan is required' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_matches) AS game WHERE
    (game->>'homeTeamId')::uuid IS DISTINCT FROM squads[1] OR (game->>'awayTeamId')::uuid IS DISTINCT FROM squads[2]) THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: Saved squads changed. Refresh the fixture plan.' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.matches(season_id, home_team_id, away_team_id, round_number, duel_sequence_number,
    home_pool_player_ids, away_pool_player_ids, status)
  SELECT p_season_id, squads[1], squads[2], (game->>'roundNumber')::integer, (game->>'sequenceNumber')::integer,
    ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(game->'homePoolPlayerIds')),
    ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(game->'awayPoolPlayerIds')), 'scheduled'
  FROM jsonb_array_elements(p_matches) AS game;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  PERFORM public.validate_league_duel_season(p_season_id);
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.save_league_duel_draft_atomic(uuid, jsonb, bigint, text, text),
  public.generate_league_duel_matches_atomic(uuid, jsonb, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_league_duel_draft_atomic(uuid, jsonb, bigint, text, text),
  public.generate_league_duel_matches_atomic(uuid, jsonb, bigint, text, text) TO authenticated;

CREATE FUNCTION public.guard_league_duel_draft_priority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Existing roster, format and clear operations already invalidate this snapshot.
  IF NEW.format IS DISTINCT FROM OLD.format OR NEW.duel_draft_rating_revision IS NULL
    OR NEW.duel_draft_rating_fingerprint IS NULL THEN
    NEW.duel_draft_priority := NULL;
  END IF;
  -- Generated lineups retain their priority, including legacy NULL values.
  IF NEW.duel_draft_priority IS DISTINCT FROM OLD.duel_draft_priority AND EXISTS (
    SELECT 1 FROM public.matches WHERE season_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Team Duel draft priority is frozen after generation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_league_duel_draft_priority() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_league_duel_draft_priority() TO authenticated;
CREATE TRIGGER zz_guard_league_duel_draft_priority BEFORE UPDATE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.guard_league_duel_draft_priority();
