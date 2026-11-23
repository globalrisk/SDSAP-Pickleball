-- Preserve the planned lineups introduced by the Season 17 and 18 corrections.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS duel_planned_home_pool_player_ids uuid[],
  ADD COLUMN IF NOT EXISTS duel_planned_away_pool_player_ids uuid[];
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_duel_planned_lineup_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_duel_planned_lineup_check CHECK (
  (duel_planned_home_pool_player_ids IS NULL AND duel_planned_away_pool_player_ids IS NULL)
  OR (duel_sequence_number IS NOT NULL
    AND (duel_planned_home_pool_player_ids IS NULL OR (
      cardinality(duel_planned_home_pool_player_ids) = 2
      AND duel_planned_home_pool_player_ids IS DISTINCT FROM home_pool_player_ids))
    AND (duel_planned_away_pool_player_ids IS NULL OR (
      cardinality(duel_planned_away_pool_player_ids) = 2
      AND duel_planned_away_pool_player_ids IS DISTINCT FROM away_pool_player_ids)))
);
COMMENT ON COLUMN public.matches.duel_planned_home_pool_player_ids IS
  'Original home lineup, stored only when it differs from the actual lineup.';
COMMENT ON COLUMN public.matches.duel_planned_away_pool_player_ids IS
  'Original away lineup, stored only when it differs from the actual lineup.';

DROP INDEX public.matches_unique_four_players_per_season;
CREATE UNIQUE INDEX matches_unique_four_players_per_season ON public.matches (
  season_id,
  public.duel_match_participant_key(
    coalesce(duel_planned_home_pool_player_ids, home_pool_player_ids),
    coalesce(duel_planned_away_pool_player_ids, away_pool_player_ids)
  )
) WHERE duel_sequence_number IS NOT NULL
    AND cardinality(home_pool_player_ids) = 2 AND cardinality(away_pool_player_ids) = 2;

CREATE OR REPLACE FUNCTION public.validate_league_duel_mirror_season(p_season_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE squad_count integer; roster_count integer; size integer; fixture_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id AND format = 'team_duel') THEN RETURN; END IF;
  SELECT count(*) INTO squad_count FROM public.teams WHERE season_id = p_season_id;
  IF squad_count = 0 THEN
    IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id) THEN
      RAISE EXCEPTION 'Team Duel fixtures require two squads';
    END IF;
    RETURN;
  END IF;
  SELECT count(*) INTO roster_count FROM public.season_roster WHERE season_id = p_season_id;
  size := roster_count / 2;
  IF squad_count <> 2 OR roster_count NOT IN (8, 10, 12, 14) OR EXISTS (
    SELECT 1 FROM public.teams AS team LEFT JOIN public.players AS player ON player.team_id = team.id
    WHERE team.season_id = p_season_id GROUP BY team.id
    HAVING count(player.id) <> size OR count(player.duel_rank) <> size
      OR min(player.duel_rank) <> 1 OR max(player.duel_rank) <> size
  ) OR EXISTS (
    SELECT 1 FROM public.season_roster AS roster WHERE roster.season_id = p_season_id
      AND NOT EXISTS (SELECT 1 FROM public.players WHERE season_id = p_season_id AND pool_player_id = roster.pool_player_id)
  ) THEN RAISE EXCEPTION 'Team Duel requires two equal squads, complete roster coverage, and contiguous ranks' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO fixture_count FROM public.matches WHERE season_id = p_season_id;
  IF fixture_count > 0 AND (fixture_count <> size * (size - 1) / 2 OR EXISTS (
    SELECT 1 FROM public.league_duel_schedule(size) AS expected
    LEFT JOIN public.matches AS match ON match.season_id = p_season_id AND match.duel_sequence_number = expected.sequence_number
    WHERE match.id IS NULL OR match.round_number <> expected.round_number
      OR ARRAY(SELECT player.duel_rank FROM public.players AS player
        WHERE player.team_id = match.home_team_id AND player.pool_player_id = ANY(coalesce(match.duel_planned_home_pool_player_ids, match.home_pool_player_ids))
        ORDER BY player.duel_rank) <> ARRAY[expected.rank_1, expected.rank_2]
  )) THEN RAISE EXCEPTION 'Team Duel schedule must contain every mirrored partnership exactly once' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_league_duel_legacy_season(p_season_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE mode text; season_format text; squad_count integer; roster_count integer; size integer; fixture_count integer; rounds integer;
BEGIN
  SELECT format, duel_schedule_mode INTO season_format, mode FROM public.seasons WHERE id = p_season_id;
  IF season_format IS DISTINCT FROM 'team_duel' THEN RETURN; END IF;
  IF mode IS NULL THEN PERFORM public.validate_league_duel_mirror_season(p_season_id); RETURN; END IF;
  SELECT count(*) INTO squad_count FROM public.teams WHERE season_id = p_season_id;
  SELECT count(*) INTO fixture_count FROM public.matches WHERE season_id = p_season_id;
  IF squad_count = 0 AND fixture_count = 0 THEN RETURN; END IF;
  SELECT count(*) INTO roster_count FROM public.season_roster WHERE season_id = p_season_id;
  size := roster_count / 2; rounds := size - 1 + size % 2;
  IF squad_count <> 2 OR roster_count NOT IN (8, 10, 12, 14) OR EXISTS (
    SELECT 1 FROM public.teams AS team LEFT JOIN public.players AS player ON player.team_id = team.id
    WHERE team.season_id = p_season_id GROUP BY team.id
    HAVING count(player.id) <> size OR count(player.duel_rank) <> size OR min(player.duel_rank) <> 1 OR max(player.duel_rank) <> size
  ) OR EXISTS (
    SELECT 1 FROM public.players AS player WHERE player.season_id = p_season_id AND
      (player.duel_tier IS NULL OR player.duel_tier IS DISTINCT FROM public.league_duel_rank_tier(player.duel_rank, size)
       OR NOT EXISTS (SELECT 1 FROM public.season_roster WHERE season_id = p_season_id AND pool_player_id = player.pool_player_id))
  ) OR EXISTS (
    SELECT 1 FROM public.season_roster AS roster WHERE roster.season_id = p_season_id
      AND NOT EXISTS (SELECT 1 FROM public.players WHERE season_id = p_season_id AND pool_player_id = roster.pool_player_id)
  ) THEN RAISE EXCEPTION 'Team Duel requires equal tier composition, complete roster coverage, and contiguous ranks' USING ERRCODE = '23514'; END IF;
  IF fixture_count = 0 THEN RETURN; END IF;
  IF fixture_count <> size * (size - 1) / 2 OR EXISTS (
    SELECT 1 FROM public.matches WHERE season_id = p_season_id AND
      (duel_sequence_number IS NULL OR duel_sequence_number NOT BETWEEN 1 AND fixture_count OR round_number IS NULL OR round_number NOT BETWEEN 1 AND rounds)
  ) OR (SELECT count(DISTINCT round_number) FROM public.matches WHERE season_id = p_season_id) <> rounds OR EXISTS (
    SELECT 1 FROM public.matches WHERE season_id = p_season_id GROUP BY round_number HAVING count(*) <> size / 2
  ) OR EXISTS (
    SELECT 1 FROM public.matches AS match CROSS JOIN LATERAL unnest(
      coalesce(match.duel_planned_home_pool_player_ids, match.home_pool_player_ids) ||
      coalesce(match.duel_planned_away_pool_player_ids, match.away_pool_player_ids)) AS participant(id)
    WHERE match.season_id = p_season_id GROUP BY match.round_number, participant.id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM public.players AS first JOIN public.players AS second ON second.team_id = first.team_id AND second.pool_player_id > first.pool_player_id
    WHERE first.season_id = p_season_id AND NOT EXISTS (
      SELECT 1 FROM public.matches AS match WHERE match.season_id = p_season_id AND
        ((match.home_team_id = first.team_id AND ARRAY[first.pool_player_id, second.pool_player_id] <@ coalesce(match.duel_planned_home_pool_player_ids, match.home_pool_player_ids))
         OR (match.away_team_id = first.team_id AND ARRAY[first.pool_player_id, second.pool_player_id] <@ coalesce(match.duel_planned_away_pool_player_ids, match.away_pool_player_ids)))
    )
  ) THEN RAISE EXCEPTION 'Team Duel schedule requires every partnership once on both sides and conflict-free complete rounds' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_league_duel_season(p_season_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target public.seasons%ROWTYPE; size integer; fixture_count integer; squad_ids uuid[]; expected_count integer;
BEGIN
  SELECT * INTO target FROM public.seasons WHERE id=p_season_id;
  IF target.duel_schedule_mode IS DISTINCT FROM 'flexible' THEN PERFORM public.validate_league_duel_legacy_season(p_season_id); RETURN; END IF;
  IF target.format IS DISTINCT FROM 'team_duel' THEN RAISE EXCEPTION 'Flexible plans require Team Duel'; END IF;
  SELECT count(*) INTO fixture_count FROM public.matches WHERE season_id=p_season_id;
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE season_id=p_season_id) AND fixture_count=0 THEN RETURN; END IF;
  SELECT count(*)/2 INTO size FROM public.season_roster WHERE season_id=p_season_id;
  IF size NOT BETWEEN 4 AND 7 OR (SELECT count(*) FROM public.season_roster WHERE season_id=p_season_id) <> size*2
    OR (SELECT count(*) FROM public.teams WHERE season_id=p_season_id) <> 2
    OR EXISTS(SELECT 1 FROM public.teams t LEFT JOIN public.players p ON p.team_id=t.id WHERE t.season_id=p_season_id GROUP BY t.id
      HAVING count(p.id)<>size OR count(DISTINCT p.duel_rank)<>size OR min(p.duel_rank)<>1 OR max(p.duel_rank)<>size)
    OR EXISTS(SELECT 1 FROM public.players p WHERE p.season_id=p_season_id AND NOT EXISTS(SELECT 1 FROM public.season_roster r WHERE r.season_id=p_season_id AND r.pool_player_id=p.pool_player_id))
    OR (SELECT count(DISTINCT pool_player_id) FROM public.players WHERE season_id=p_season_id)<>size*2 THEN
    RAISE EXCEPTION 'Flexible squads must cover the complete roster with contiguous ranks' USING ERRCODE='23514';
  END IF;
  IF target.duel_draft_plan IS NULL THEN
    IF fixture_count>0 THEN RAISE EXCEPTION 'Generated flexible games require a saved plan'; END IF;
    RETURN;
  END IF;
  PERFORM public.validate_flexible_duel_plan(p_season_id,target.duel_draft_plan,false);
  FOR expected_count IN 0..1 LOOP
    IF NOT EXISTS(SELECT 1 FROM public.teams t WHERE t.season_id=p_season_id AND
      (SELECT array_agg(pool_player_id ORDER BY duel_rank) FROM public.players WHERE team_id=t.id)
      = ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(target.duel_draft_plan->'squads'->expected_count))) THEN
      RAISE EXCEPTION 'DUEL_STALE_DRAFT: Saved squads and plan differ' USING ERRCODE='40001';
    END IF;
  END LOOP;
  IF fixture_count=0 THEN RETURN; END IF;
  expected_count := size*(size-1)/2;
  IF fixture_count<>expected_count OR EXISTS(
    SELECT 1 FROM public.matches m WHERE m.season_id=p_season_id AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(target.duel_draft_plan->'option'->'games') g
      WHERE m.duel_sequence_number=(g->>'sequenceNumber')::integer AND m.round_number=(g->>'roundNumber')::integer
        AND coalesce(m.duel_planned_home_pool_player_ids, m.home_pool_player_ids)=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(g->'homePoolPlayerIds'))
        AND coalesce(m.duel_planned_away_pool_player_ids, m.away_pool_player_ids)=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(g->'awayPoolPlayerIds'))
        AND (SELECT count(*) FROM public.players p WHERE p.team_id=m.home_team_id AND p.pool_player_id=ANY(m.home_pool_player_ids))=2
        AND (SELECT count(*) FROM public.players p WHERE p.team_id=m.away_team_id AND p.pool_player_id=ANY(m.away_pool_player_ids))=2
    )) THEN RAISE EXCEPTION 'Generated fixtures must match the saved preview exactly' USING ERRCODE='23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_league_duel_match()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE season_format text; mode text; home_tiers text[]; away_tiers text[]; home_ranks integer[]; away_ranks integer[];
  planned_home uuid[]; planned_away uuid[];
  planned_home_ranks integer[]; planned_away_ranks integer[];
BEGIN
  SELECT format, duel_schedule_mode INTO season_format, mode FROM public.seasons WHERE id = COALESCE(NEW.season_id, OLD.season_id) FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    IF season_format = 'team_duel' THEN PERFORM public.assert_league_duel_fixtures_clearable(OLD.season_id); END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.duel_sequence_number IS NOT NULL AND
    (NEW.season_id, NEW.home_team_id, NEW.away_team_id, NEW.round_number, NEW.duel_sequence_number) IS DISTINCT FROM
    (OLD.season_id, OLD.home_team_id, OLD.away_team_id, OLD.round_number, OLD.duel_sequence_number) THEN
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
    OR array_position(home_ranks, NULL) IS NOT NULL OR array_position(away_ranks, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A Team Duel fixture requires two distinct players from each season squad' USING ERRCODE = '23514';
  END IF;
  planned_home := coalesce(NEW.duel_planned_home_pool_player_ids, NEW.home_pool_player_ids);
  planned_away := coalesce(NEW.duel_planned_away_pool_player_ids, NEW.away_pool_player_ids);
  IF mode IS NULL THEN
    SELECT array_agg(duel_rank ORDER BY duel_rank) INTO planned_home_ranks FROM public.players
      WHERE team_id = NEW.home_team_id AND pool_player_id = ANY(planned_home);
    SELECT array_agg(duel_rank ORDER BY duel_rank) INTO planned_away_ranks FROM public.players
      WHERE team_id = NEW.away_team_id AND pool_player_id = ANY(planned_away);
    IF planned_home_ranks IS DISTINCT FROM planned_away_ranks THEN
      RAISE EXCEPTION 'Both sides must use the same pair of frozen squad ranks';
    END IF;
  ELSIF mode = 'tier_matched' THEN
    SELECT array_agg(duel_tier ORDER BY duel_tier) INTO home_tiers FROM public.players
      WHERE team_id = NEW.home_team_id AND pool_player_id = ANY(planned_home);
    SELECT array_agg(duel_tier ORDER BY duel_tier) INTO away_tiers FROM public.players
      WHERE team_id = NEW.away_team_id AND pool_player_id = ANY(planned_away);
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

-- A transaction-scoped authorization, separate from session settings clients
-- can change. Result writes must still send the currently saved actual lineup.
CREATE TABLE pickle_private.duel_substitution_context (
  transaction_id bigint NOT NULL,
  match_id uuid NOT NULL,
  PRIMARY KEY (transaction_id, match_id)
);
ALTER TABLE pickle_private.duel_substitution_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pickle_private.duel_substitution_context FROM PUBLIC, anon, authenticated;

CREATE FUNCTION pickle_private.duel_substitution_in_progress(p_match_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM pickle_private.duel_substitution_context
    WHERE transaction_id = txid_current() AND match_id = p_match_id
  );
$$;
REVOKE ALL ON FUNCTION pickle_private.duel_substitution_in_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pickle_private.duel_substitution_in_progress(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_duel_planned_lineup()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.duel_planned_home_pool_player_ids IS NULL AND NEW.duel_planned_away_pool_player_ids IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF (NEW.duel_planned_home_pool_player_ids, NEW.duel_planned_away_pool_player_ids)
      IS NOT DISTINCT FROM (OLD.duel_planned_home_pool_player_ids, OLD.duel_planned_away_pool_player_ids)
    AND (OLD.duel_sequence_number IS NULL OR (NEW.home_pool_player_ids, NEW.away_pool_player_ids)
      IS NOT DISTINCT FROM (OLD.home_pool_player_ids, OLD.away_pool_player_ids)) THEN
    RETURN NEW;
  ELSIF pickle_private.duel_substitution_in_progress(OLD.id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DUEL_SUB_STALE: Team Duel lineups are frozen outside player replacement'
    USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_duel_planned_lineup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_duel_planned_lineup() TO authenticated;

DROP TRIGGER IF EXISTS matches_guard_duel_planned_lineup ON public.matches;
CREATE TRIGGER matches_guard_duel_planned_lineup
  BEFORE INSERT OR UPDATE OF home_pool_player_ids, away_pool_player_ids,
    duel_planned_home_pool_player_ids, duel_planned_away_pool_player_ids ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_duel_planned_lineup();

CREATE FUNCTION pickle_private.replace_league_duel_match_player(
  p_match_id uuid, p_outgoing_player_id uuid, p_incoming_player_id uuid,
  p_expected_home uuid[], p_expected_away uuid[]
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.matches;
  target_season_id uuid;
  target_league_id uuid;
  outgoing_team_id uuid;
  planned_home uuid[];
  planned_away uuid[];
  actual_home uuid[];
  actual_away uuid[];
  actual_participants uuid[];
  next_status text;
BEGIN
  IF NOT pickle_private.is_admin() THEN
    RAISE EXCEPTION 'DUEL_SUB_ADMIN: Administrator access is required' USING ERRCODE = '42501';
  END IF;
  SELECT m.season_id, s.league_id INTO target_season_id, target_league_id
  FROM public.matches m JOIN public.seasons s ON s.id = m.season_id WHERE m.id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DUEL_SUB_STALE: Match was not found' USING ERRCODE = '40001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:' || target_league_id::text, 0));
  -- Live and direct writes may already hold the queue or a row lock.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sdsap_live_queue:' || target_season_id::text, 0)) THEN
    RAISE lock_not_available;
  END IF;
  PERFORM 1 FROM public.seasons s JOIN public.leagues l ON l.id = s.league_id
  WHERE s.id = target_season_id AND s.league_id = target_league_id
    AND s.format = 'team_duel' AND s.status = 'active' AND l.status = 'active'
  FOR UPDATE OF s NOWAIT FOR SHARE OF l NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DUEL_SUB_LOCKED: An active Team Duel season is required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO target FROM public.matches
    WHERE id = p_match_id AND season_id = target_season_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR target.duel_sequence_number IS NULL
    OR target.status <> 'scheduled' OR target.live_status = 'playing'
    OR target.betting_closed_at IS NOT NULL OR target.result_recorded_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.rating_history WHERE match_id = p_match_id) THEN
    RAISE EXCEPTION 'DUEL_SUB_LOCKED: The match lineup is locked' USING ERRCODE = '23514';
  END IF;
  IF target.home_pool_player_ids IS DISTINCT FROM p_expected_home
    OR target.away_pool_player_ids IS DISTINCT FROM p_expected_away THEN
    RAISE EXCEPTION 'DUEL_SUB_STALE: Match lineup changed' USING ERRCODE = '40001';
  END IF;

  actual_home := target.home_pool_player_ids;
  actual_away := target.away_pool_player_ids;
  planned_home := coalesce(target.duel_planned_home_pool_player_ids, actual_home);
  planned_away := coalesce(target.duel_planned_away_pool_player_ids, actual_away);
  IF p_outgoing_player_id = ANY(actual_home) THEN
    outgoing_team_id := target.home_team_id;
    actual_home := array_replace(actual_home, p_outgoing_player_id, p_incoming_player_id);
  ELSIF p_outgoing_player_id = ANY(actual_away) THEN
    outgoing_team_id := target.away_team_id;
    actual_away := array_replace(actual_away, p_outgoing_player_id, p_incoming_player_id);
  ELSE
    RAISE EXCEPTION 'DUEL_SUB_STALE: The outgoing player is no longer in this match' USING ERRCODE = '40001';
  END IF;
  IF p_incoming_player_id = ANY(target.home_pool_player_ids || target.away_pool_player_ids) OR NOT EXISTS (
    SELECT 1 FROM public.players p JOIN public.league_players member
      ON member.league_id = target_league_id AND member.pool_player_id = p.pool_player_id
    WHERE p.season_id = target_season_id AND p.team_id = outgoing_team_id
      AND p.pool_player_id = p_incoming_player_id AND member.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.matches m
    WHERE m.season_id = target_season_id AND m.status = 'scheduled' AND m.live_status = 'playing'
      AND p_incoming_player_id = ANY(public.league_match_participant_ids(m))
  ) THEN
    RAISE EXCEPTION 'DUEL_SUB_INELIGIBLE: Choose an active teammate free to join this match' USING ERRCODE = '23514';
  END IF;

  next_status := target.live_status;
  actual_participants := actual_home || actual_away;
  IF next_status = 'up_next' AND (
    (SELECT count(*) FROM public.players WHERE season_id = target_season_id AND is_present
      AND pool_player_id = ANY(actual_participants)) <> 4
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.season_id = target_season_id AND m.status = 'scheduled' AND m.live_status = 'playing'
        AND actual_participants && public.league_match_participant_ids(m)
    )
  ) THEN
    next_status := 'available';
  END IF;

  INSERT INTO pickle_private.duel_substitution_context VALUES (txid_current(), p_match_id);
  UPDATE public.matches
  SET home_pool_player_ids = actual_home, away_pool_player_ids = actual_away,
      duel_planned_home_pool_player_ids = nullif(planned_home, actual_home),
      duel_planned_away_pool_player_ids = nullif(planned_away, actual_away),
      live_status = next_status
  WHERE id = p_match_id;
  DELETE FROM pickle_private.duel_substitution_context
  WHERE transaction_id = txid_current() AND match_id = p_match_id;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'DUEL_SUB_BUSY: Match operations are in progress. Review and try again'
    USING ERRCODE = '40001';
END;
$$;
REVOKE ALL ON FUNCTION pickle_private.replace_league_duel_match_player(uuid, uuid, uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pickle_private.replace_league_duel_match_player(uuid, uuid, uuid, uuid[], uuid[]) TO authenticated;

CREATE FUNCTION public.replace_league_duel_match_player(
  p_match_id uuid, p_outgoing_player_id uuid, p_incoming_player_id uuid,
  p_expected_home uuid[], p_expected_away uuid[]
)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT pickle_private.replace_league_duel_match_player(
    p_match_id, p_outgoing_player_id, p_incoming_player_id, p_expected_home, p_expected_away
  );
$$;
REVOKE ALL ON FUNCTION public.replace_league_duel_match_player(uuid, uuid, uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_league_duel_match_player(uuid, uuid, uuid, uuid[], uuid[]) TO authenticated;
