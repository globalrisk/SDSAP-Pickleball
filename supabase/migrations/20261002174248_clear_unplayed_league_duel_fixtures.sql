-- Allow administrators to clear a complete, unplayed active Team Duel schedule.
-- Results, linked rating history, and games currently on court remain protected.
CREATE FUNCTION public.assert_league_duel_fixtures_clearable(p_season_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Administrator access is required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id AND status = 'active' AND format = 'team_duel') THEN
    RAISE EXCEPTION 'Select an active Team Duel season first' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id AND
    (status IS DISTINCT FROM 'scheduled' OR home_score IS NOT NULL OR away_score IS NOT NULL
      OR winner_team_id IS NOT NULL OR result_recorded_at IS NOT NULL OR live_status = 'playing'))
    OR EXISTS (SELECT 1 FROM public.rating_history AS history JOIN public.matches AS match ON match.id = history.match_id
      WHERE match.season_id = p_season_id) THEN
    RAISE EXCEPTION 'DUEL_CLEAR_BLOCKED: Only a complete schedule without results, rating history, or games on court can be cleared.' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.clear_unplayed_league_duel_fixtures_atomic(p_season_id uuid, p_expected_match_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; current_ids uuid[]; expected_ids uuid[]; deleted integer;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Administrator access is required' USING ERRCODE = '42501';
  END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id = p_season_id;
  PERFORM 1 FROM public.rating_state WHERE league_id = league FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_season_setup:' || p_season_id::text, 0));
  -- Live transitions take this lock before locking a fixture and its season.
  PERFORM pg_advisory_xact_lock(hashtextextended('sdsap_live_queue:' || p_season_id::text, 0));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id AND status = 'active' AND format = 'team_duel' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active Team Duel season first' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM public.matches WHERE season_id = p_season_id ORDER BY id FOR UPDATE;
  SELECT array_agg(id ORDER BY id) INTO current_ids FROM public.matches WHERE season_id = p_season_id;
  SELECT array_agg(id ORDER BY id) INTO expected_ids FROM unnest(p_expected_match_ids) AS selected(id);
  IF COALESCE(cardinality(expected_ids), 0) = 0 OR expected_ids IS DISTINCT FROM current_ids THEN
    RAISE EXCEPTION 'DUEL_CLEAR_STALE: The fixture list changed. Refresh before clearing it.' USING ERRCODE = '40001';
  END IF;
  PERFORM public.assert_league_duel_fixtures_clearable(p_season_id);
  DELETE FROM public.matches WHERE season_id = p_season_id AND id = ANY(current_ids);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  -- Preserve squads and the selected roster; a fresh saved draft is required.
  UPDATE public.seasons SET duel_draft_rating_revision = NULL, duel_draft_rating_fingerprint = NULL WHERE id = p_season_id;
  PERFORM public.validate_league_duel_season(p_season_id);
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_league_duel_fixtures_clearable(uuid),
  public.clear_unplayed_league_duel_fixtures_atomic(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_league_duel_fixtures_clearable(uuid),
  public.clear_unplayed_league_duel_fixtures_atomic(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_league_duel_match()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE season_format text; mode text; home_tiers text[]; away_tiers text[]; home_ranks integer[]; away_ranks integer[];
BEGIN
  SELECT format, duel_schedule_mode INTO season_format, mode FROM public.seasons WHERE id = COALESCE(NEW.season_id, OLD.season_id) FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    IF season_format = 'team_duel' THEN PERFORM public.assert_league_duel_fixtures_clearable(OLD.season_id); END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.duel_sequence_number IS NOT NULL AND
    (NEW.season_id, NEW.home_team_id, NEW.away_team_id, NEW.round_number, NEW.duel_sequence_number,
      NEW.home_pool_player_ids, NEW.away_pool_player_ids) IS DISTINCT FROM
    (OLD.season_id, OLD.home_team_id, OLD.away_team_id, OLD.round_number, OLD.duel_sequence_number,
      OLD.home_pool_player_ids, OLD.away_pool_player_ids) THEN
    RAISE EXCEPTION 'Team Duel fixture lineups and ranks are frozen' USING ERRCODE = '23514';
  END IF;
  IF season_format <> 'team_duel' THEN
    IF NEW.duel_sequence_number IS NOT NULL THEN RAISE EXCEPTION 'Only Team Duel fixtures have sequence numbers'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND mode IS NULL THEN RAISE EXCEPTION 'DUEL_STALE_DRAFT: Save a tier-matched draft before generating fixtures.' USING ERRCODE = '40001'; END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.matches WHERE season_id = NEW.season_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.seasons AS season
      WHERE season.id = NEW.season_id AND season.status = 'active'
        AND season.duel_draft_rating_revision = (public.league_duel_rating_snapshot(season.league_id)->>'revision')::bigint
        AND season.duel_draft_rating_fingerprint = public.league_duel_rating_snapshot(season.league_id)->>'fingerprint') THEN
      RAISE EXCEPTION 'DUEL_STALE_DRAFT: Refresh and save a draft before generating fixtures.' USING ERRCODE = '40001';
    END IF;
    PERFORM public.validate_league_duel_draft_ratings(NEW.season_id);
  END IF;
  IF NEW.duel_sequence_number IS NULL OR cardinality(NEW.home_pool_player_ids) IS DISTINCT FROM 2
    OR cardinality(NEW.away_pool_player_ids) IS DISTINCT FROM 2
    OR NEW.home_team_id = NEW.away_team_id OR EXISTS (
      SELECT 1 FROM public.teams WHERE id IN (NEW.home_team_id, NEW.away_team_id) AND season_id <> NEW.season_id
    ) THEN RAISE EXCEPTION 'A Team Duel fixture requires two frozen players from each season squad'; END IF;
  SELECT array_agg(duel_rank ORDER BY duel_rank) INTO home_ranks FROM public.players
    WHERE team_id = NEW.home_team_id AND pool_player_id = ANY(NEW.home_pool_player_ids);
  SELECT array_agg(duel_rank ORDER BY duel_rank) INTO away_ranks FROM public.players
    WHERE team_id = NEW.away_team_id AND pool_player_id = ANY(NEW.away_pool_player_ids);
  IF cardinality(home_ranks) IS DISTINCT FROM 2 OR cardinality(away_ranks) IS DISTINCT FROM 2
    OR array_position(home_ranks, NULL) IS NOT NULL OR array_position(away_ranks, NULL) IS NOT NULL
    OR (mode IS NULL AND home_ranks IS DISTINCT FROM away_ranks) THEN
    RAISE EXCEPTION 'Both sides must use the same pair of frozen squad ranks';
  END IF;
  IF mode = 'tier_matched' THEN
    SELECT array_agg(duel_tier ORDER BY duel_tier) INTO home_tiers FROM public.players
      WHERE team_id = NEW.home_team_id AND pool_player_id = ANY(NEW.home_pool_player_ids);
    SELECT array_agg(duel_tier ORDER BY duel_tier) INTO away_tiers FROM public.players
      WHERE team_id = NEW.away_team_id AND pool_player_id = ANY(NEW.away_pool_player_ids);
    IF array_position(home_tiers, NULL) IS NOT NULL OR array_position(away_tiers, NULL) IS NOT NULL OR home_tiers IS DISTINCT FROM away_tiers THEN
      RAISE EXCEPTION 'Both sides must use the same frozen tier combination' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'completed' AND (NEW.home_score IS NULL OR NEW.away_score IS NULL
    OR GREATEST(NEW.home_score, NEW.away_score) < 11 OR abs(NEW.home_score - NEW.away_score) < 2) THEN
    RAISE EXCEPTION 'A Team Duel game requires at least 11 points and a two-point margin' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
