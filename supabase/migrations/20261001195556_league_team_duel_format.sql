-- League Team Duel uses the existing result/rating history. Standalone duels
-- deliberately retain their separate, unrated scheduling rules.
ALTER TABLE public.seasons
  ADD COLUMN format text NOT NULL DEFAULT 'round_robin'
    CHECK (format IN ('round_robin', 'team_duel')),
  ADD COLUMN duel_draft_rating_revision bigint,
  ADD COLUMN duel_draft_rating_fingerprint text;
ALTER TABLE public.players ADD COLUMN duel_rank integer CHECK (duel_rank BETWEEN 1 AND 7);
CREATE UNIQUE INDEX players_unique_duel_rank ON public.players(team_id, duel_rank)
  WHERE duel_rank IS NOT NULL;
ALTER TABLE public.matches ADD COLUMN duel_sequence_number integer
  CHECK (duel_sequence_number > 0);
DROP INDEX public.matches_one_fixture_per_pair_per_season;
CREATE UNIQUE INDEX matches_one_fixture_per_pair_per_season ON public.matches
  (season_id, LEAST(home_team_id, away_team_id), GREATEST(home_team_id, away_team_id))
  WHERE duel_sequence_number IS NULL;
CREATE UNIQUE INDEX matches_unique_duel_sequence ON public.matches(season_id, duel_sequence_number)
  WHERE duel_sequence_number IS NOT NULL;

CREATE FUNCTION public.league_duel_rating_snapshot(p_league_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('revision', state.revision, 'fingerprint',
    md5(COALESCE((SELECT string_agg(
      membership.pool_player_id::text || ':' || membership.rating::text || ':' ||
      membership.rating_deviation::text || ':' || membership.volatility::text || ':' || membership.status,
      ',' ORDER BY membership.pool_player_id)
      FROM public.league_players AS membership WHERE membership.league_id = p_league_id), '')))
  FROM public.rating_state AS state WHERE state.league_id = p_league_id;
$$;

-- Same fixed-first circle as the standalone TypeScript generator, extended to 7.
CREATE FUNCTION public.league_duel_schedule(p_size integer)
RETURNS TABLE(round_number integer, sequence_number integer, rank_1 integer, rank_2 integer)
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE rotation integer[]; slots integer; r integer; i integer;
BEGIN
  IF p_size NOT BETWEEN 4 AND 7 THEN RAISE EXCEPTION 'Squads must have 4–7 players'; END IF;
  SELECT array_agg(n ORDER BY n) INTO rotation FROM generate_series(1, p_size) AS n;
  IF p_size % 2 = 1 THEN rotation := array_append(rotation, NULL); END IF;
  slots := cardinality(rotation); sequence_number := 0;
  FOR r IN 1..slots - 1 LOOP
    FOR i IN 1..slots / 2 LOOP
      IF rotation[i] IS NOT NULL AND rotation[slots + 1 - i] IS NOT NULL THEN
        round_number := r; sequence_number := sequence_number + 1;
        rank_1 := LEAST(rotation[i], rotation[slots + 1 - i]);
        rank_2 := GREATEST(rotation[i], rotation[slots + 1 - i]);
        RETURN NEXT;
      END IF;
    END LOOP;
    rotation := ARRAY[rotation[1], rotation[slots]] || rotation[2:slots - 1];
  END LOOP;
END;
$$;

CREATE FUNCTION public.validate_league_duel_season(p_season_id uuid)
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
        WHERE player.team_id = match.home_team_id AND player.pool_player_id = ANY(match.home_pool_player_ids)
        ORDER BY player.duel_rank) <> ARRAY[expected.rank_1, expected.rank_2]
  )) THEN RAISE EXCEPTION 'Team Duel schedule must contain every mirrored partnership exactly once' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_team_has_two_players()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target uuid; old_target uuid; season_id uuid; season_format text;
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    PERFORM public.validate_league_duel_season(COALESCE(NEW.season_id, OLD.season_id));
    IF TG_OP = 'UPDATE' AND NEW.season_id IS DISTINCT FROM OLD.season_id THEN
      PERFORM public.validate_league_duel_season(OLD.season_id);
    END IF;
    target := COALESCE(NEW.id, OLD.id);
  ELSE target := COALESCE(NEW.team_id, OLD.team_id);
    IF TG_OP = 'UPDATE' THEN old_target := OLD.team_id; END IF;
  END IF;
  FOR target IN SELECT DISTINCT id FROM unnest(ARRAY[target, old_target]) AS id WHERE id IS NOT NULL LOOP
    SELECT team.season_id, season.format INTO season_id, season_format
      FROM public.teams AS team JOIN public.seasons AS season ON season.id = team.season_id WHERE team.id = target;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF season_format = 'team_duel' THEN PERFORM public.validate_league_duel_season(season_id);
    ELSIF (SELECT count(*) FROM public.players WHERE team_id = target) <> 2
      OR EXISTS (SELECT 1 FROM public.players WHERE team_id = target AND duel_rank IS NOT NULL) THEN
      RAISE EXCEPTION 'Round-robin teams must have exactly two players without duel ranks' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.check_league_duel_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'matches' AND TG_OP = 'UPDATE' THEN
    IF (NEW.season_id, NEW.home_team_id, NEW.away_team_id, NEW.round_number, NEW.duel_sequence_number,
      NEW.home_pool_player_ids, NEW.away_pool_player_ids) IS NOT DISTINCT FROM
      (OLD.season_id, OLD.home_team_id, OLD.away_team_id, OLD.round_number, OLD.duel_sequence_number,
      OLD.home_pool_player_ids, OLD.away_pool_player_ids) THEN RETURN NULL; END IF;
  END IF;
  PERFORM public.validate_league_duel_season(COALESCE(NEW.season_id, OLD.season_id));
  IF TG_OP = 'UPDATE' AND NEW.season_id IS DISTINCT FROM OLD.season_id THEN
    PERFORM public.validate_league_duel_season(OLD.season_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER matches_check_duel_schedule AFTER INSERT OR UPDATE OR DELETE ON public.matches
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_league_duel_schedule();
CREATE CONSTRAINT TRIGGER roster_check_duel_squads AFTER INSERT OR UPDATE OR DELETE ON public.season_roster
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_league_duel_schedule();

CREATE FUNCTION public.guard_league_duel_roster()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target uuid; season_format text; immutable_change boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.season_id IS DISTINCT FROM OLD.season_id AND EXISTS (
    SELECT 1 FROM public.seasons AS season JOIN public.matches AS match ON match.season_id = season.id
      WHERE season.id = OLD.season_id AND season.format = 'team_duel'
  ) THEN RAISE EXCEPTION 'Team Duel membership and ranks are frozen after schedule generation'; END IF;
  target := COALESCE(NEW.season_id, OLD.season_id);
  SELECT format INTO season_format FROM public.seasons WHERE id = target FOR UPDATE;
  IF season_format <> 'team_duel' OR season_format IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  immutable_change := TG_OP <> 'UPDATE';
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'players' THEN
      immutable_change := (NEW.team_id, NEW.season_id, NEW.pool_player_id, NEW.duel_rank)
        IS DISTINCT FROM (OLD.team_id, OLD.season_id, OLD.pool_player_id, OLD.duel_rank);
    ELSIF TG_TABLE_NAME = 'season_roster' THEN
      immutable_change := (NEW.season_id, NEW.pool_player_id)
        IS DISTINCT FROM (OLD.season_id, OLD.pool_player_id);
    ELSE immutable_change := NEW.season_id IS DISTINCT FROM OLD.season_id; END IF;
  END IF;
  IF immutable_change AND EXISTS (SELECT 1 FROM public.matches WHERE season_id = target) THEN
    RAISE EXCEPTION 'Team Duel membership and ranks are frozen after schedule generation' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'players' THEN
    IF TG_OP <> 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.season_roster WHERE season_id = NEW.season_id AND pool_player_id = NEW.pool_player_id
    ) THEN RAISE EXCEPTION 'Select every squad player for this season first'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER players_guard_duel_roster BEFORE INSERT OR UPDATE OR DELETE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.guard_league_duel_roster();
CREATE TRIGGER teams_guard_duel_roster BEFORE INSERT OR UPDATE OR DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_league_duel_roster();
CREATE TRIGGER roster_guard_duel_roster BEFORE INSERT OR UPDATE OR DELETE ON public.season_roster
  FOR EACH ROW EXECUTE FUNCTION public.guard_league_duel_roster();

-- Changing a pre-schedule duel roster invalidates the entire selected draft.
ALTER FUNCTION public.save_season_roster_atomic(uuid, uuid[]) RENAME TO save_season_roster_members_atomic;
CREATE FUNCTION public.save_season_roster_atomic(p_season_id uuid, p_pool_player_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE season_format text;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_season_setup:' || p_season_id::text, 0));
  SELECT format INTO season_format FROM public.seasons WHERE id = p_season_id FOR UPDATE;
  IF season_format = 'team_duel' THEN
    IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id) THEN RAISE EXCEPTION 'Team Duel roster is frozen after schedule generation'; END IF;
    DELETE FROM public.teams WHERE season_id = p_season_id;
    UPDATE public.seasons SET duel_draft_rating_revision = NULL, duel_draft_rating_fingerprint = NULL WHERE id = p_season_id;
  END IF;
  PERFORM public.save_season_roster_members_atomic(p_season_id, p_pool_player_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.save_season_roster_atomic(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_season_roster_atomic(uuid, uuid[]) TO authenticated;

CREATE FUNCTION public.guard_league_season_format()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.format IS DISTINCT FROM OLD.format THEN
    IF OLD.status <> 'active' OR EXISTS (SELECT 1 FROM public.matches WHERE season_id = OLD.id) THEN
      RAISE EXCEPTION 'Season format is locked after schedule generation';
    END IF;
    DELETE FROM public.teams WHERE season_id = OLD.id;
    NEW.duel_draft_rating_revision := NULL; NEW.duel_draft_rating_fingerprint := NULL;
  END IF;
  IF NEW.league_id IS DISTINCT FROM OLD.league_id AND
    (OLD.format = 'team_duel' OR NEW.format = 'team_duel') THEN RAISE EXCEPTION 'Team Duel cannot be moved to another league'; END IF;
  IF OLD.format = 'team_duel' AND NEW.status = 'archived' AND EXISTS (
    SELECT 1 FROM public.matches WHERE season_id = OLD.id AND status = 'scheduled'
  ) THEN RAISE EXCEPTION 'Resolve every Team Duel game before completing the season'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER seasons_guard_format BEFORE UPDATE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.guard_league_season_format();

CREATE FUNCTION public.set_season_format_atomic(p_season_id uuid, p_format text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
  IF p_format NOT IN ('round_robin', 'team_duel') OR p_format IS NULL THEN RAISE EXCEPTION 'Invalid season format'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_season_setup:' || p_season_id::text, 0));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an active season can change format'; END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id) THEN RAISE EXCEPTION 'Season format is locked after schedule generation'; END IF;
  UPDATE public.seasons SET format = p_format WHERE id = p_season_id;
END;
$$;

CREATE FUNCTION public.save_league_duel_draft_atomic(
  p_season_id uuid, p_squads jsonb, p_expected_rating_revision bigint, p_expected_rating_fingerprint text
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; season_format text; snapshot jsonb; squad jsonb; ids uuid[];
  all_ids uuid[] := ARRAY[]::uuid[]; ordered_ids uuid[]; target_team uuid; player_id uuid; position integer;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
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
  DELETE FROM public.teams WHERE season_id = p_season_id;
  FOR squad IN SELECT value FROM jsonb_array_elements(p_squads) LOOP
    INSERT INTO public.teams(season_id, name, color) VALUES (p_season_id, btrim(squad->>'name'), squad->>'color') RETURNING id INTO target_team;
    position := 0;
    FOR player_id IN SELECT value::uuid FROM jsonb_array_elements_text(squad->'poolPlayerIds') LOOP
      position := position + 1;
      INSERT INTO public.players(season_id, team_id, pool_player_id, name, duel_rank)
        SELECT p_season_id, target_team, id, name, position FROM public.player_pool WHERE id = player_id;
    END LOOP;
  END LOOP;
  UPDATE public.seasons SET duel_draft_rating_revision = p_expected_rating_revision,
    duel_draft_rating_fingerprint = p_expected_rating_fingerprint WHERE id = p_season_id;
  PERFORM public.validate_league_duel_season(p_season_id);
END;
$$;

CREATE FUNCTION public.generate_league_duel_matches_atomic(p_season_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; draft_revision bigint; draft_fingerprint text; snapshot jsonb;
  squads uuid[]; home_ids uuid[]; away_ids uuid[]; size integer; inserted integer;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id = p_season_id;
  PERFORM 1 FROM public.rating_state WHERE league_id = league FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_season_setup:' || p_season_id::text, 0));
  SELECT duel_draft_rating_revision, duel_draft_rating_fingerprint INTO draft_revision, draft_fingerprint
    FROM public.seasons WHERE id = p_season_id AND status = 'active' AND format = 'team_duel' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active Team Duel season first'; END IF;
  IF EXISTS (SELECT 1 FROM public.matches WHERE season_id = p_season_id) THEN RAISE EXCEPTION 'This season already has matches'; END IF;
  snapshot := public.league_duel_rating_snapshot(league);
  IF draft_revision IS NULL OR draft_revision IS DISTINCT FROM (snapshot->>'revision')::bigint
    OR draft_fingerprint IS DISTINCT FROM snapshot->>'fingerprint' THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: League ratings changed. Refresh and save draft options first.' USING ERRCODE = '40001';
  END IF;
  PERFORM public.validate_league_duel_season(p_season_id);
  SELECT array_agg(id ORDER BY created_at, id) INTO squads FROM public.teams WHERE season_id = p_season_id;
  IF cardinality(squads) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Save two squads first'; END IF;
  SELECT array_agg(pool_player_id ORDER BY duel_rank) INTO home_ids FROM public.players WHERE team_id = squads[1];
  SELECT array_agg(pool_player_id ORDER BY duel_rank) INTO away_ids FROM public.players WHERE team_id = squads[2];
  IF EXISTS (SELECT 1 FROM public.teams AS team WHERE team.season_id = p_season_id AND
    ARRAY(SELECT player.pool_player_id FROM public.players AS player WHERE player.team_id = team.id ORDER BY player.duel_rank)
      IS DISTINCT FROM ARRAY(SELECT player.pool_player_id FROM public.players AS player
        JOIN public.league_players AS member ON member.pool_player_id = player.pool_player_id AND member.league_id = league
        WHERE player.team_id = team.id ORDER BY member.rating DESC, player.pool_player_id)) THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: Squad ranks changed. Refresh and save draft options first.' USING ERRCODE = '40001';
  END IF;
  size := cardinality(home_ids);
  INSERT INTO public.matches(season_id, home_team_id, away_team_id, round_number, duel_sequence_number,
    home_pool_player_ids, away_pool_player_ids, status)
  SELECT p_season_id, squads[1], squads[2], schedule.round_number, schedule.sequence_number,
    ARRAY[home_ids[rank_1], home_ids[rank_2]], ARRAY[away_ids[rank_1], away_ids[rank_2]], 'scheduled'
    FROM public.league_duel_schedule(size) AS schedule;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  PERFORM public.validate_league_duel_season(p_season_id);
  RETURN inserted;
END;
$$;

CREATE FUNCTION public.guard_league_duel_match()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE season_format text; home_ranks integer[]; away_ranks integer[];
BEGIN
  SELECT format INTO season_format FROM public.seasons WHERE id = COALESCE(NEW.season_id, OLD.season_id) FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    IF season_format = 'team_duel' THEN RAISE EXCEPTION 'Generated Team Duel fixtures cannot be deleted'; END IF;
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
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.matches WHERE season_id = NEW.season_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.seasons AS season
      WHERE season.id = NEW.season_id AND season.status = 'active'
        AND season.duel_draft_rating_revision = (public.league_duel_rating_snapshot(season.league_id)->>'revision')::bigint
        AND season.duel_draft_rating_fingerprint = public.league_duel_rating_snapshot(season.league_id)->>'fingerprint') THEN
      RAISE EXCEPTION 'DUEL_STALE_DRAFT: Refresh and save a draft before generating fixtures.' USING ERRCODE = '40001';
    END IF;
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
    OR array_position(home_ranks, NULL) IS NOT NULL OR home_ranks IS DISTINCT FROM away_ranks THEN
    RAISE EXCEPTION 'Both sides must use the same pair of frozen squad ranks';
  END IF;
  IF NEW.status = 'completed' AND (NEW.home_score IS NULL OR NEW.away_score IS NULL
    OR GREATEST(NEW.home_score, NEW.away_score) < 11 OR abs(NEW.home_score - NEW.away_score) < 2) THEN
    RAISE EXCEPTION 'A Team Duel game requires at least 11 points and a two-point margin' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_guard_duel BEFORE INSERT OR UPDATE OR DELETE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_league_duel_match();

-- Resolve participants from frozen snapshots, or the ordinary two-player team.
CREATE FUNCTION public.league_match_participant_ids(p_match public.matches)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN cardinality(p_match.home_pool_player_ids) = 2 AND cardinality(p_match.away_pool_player_ids) = 2
    THEN p_match.home_pool_player_ids || p_match.away_pool_player_ids
    ELSE ARRAY(SELECT pool_player_id FROM public.players WHERE team_id IN (p_match.home_team_id, p_match.away_team_id)) END;
$$;
CREATE OR REPLACE FUNCTION public.prevent_live_team_double_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE participant_ids uuid[];
BEGIN
  IF NEW.status = 'scheduled' AND NEW.live_status IN ('playing', 'up_next') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('sdsap_live_queue:' || NEW.season_id::text, 0));
    participant_ids := public.league_match_participant_ids(NEW);
    IF (SELECT count(*) = 4 AND bool_and(is_present) FROM public.players
      WHERE season_id = NEW.season_id AND pool_player_id = ANY(participant_ids)) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'All four players must be present before queuing this match';
    END IF;
    IF EXISTS (SELECT 1 FROM public.matches AS other WHERE other.season_id = NEW.season_id AND other.id <> NEW.id
      AND other.status = 'scheduled' AND other.live_status = 'playing'
      AND participant_ids && public.league_match_participant_ids(other)) THEN
      IF NEW.duel_sequence_number IS NULL THEN
        RAISE EXCEPTION 'A team in this match is already playing on another court' USING ERRCODE = '23514';
      ELSE RAISE EXCEPTION 'A player in this match is already playing on another court' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_match_live_status(p_match_id uuid, p_live_status text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target public.matches; season_status text; configured_courts integer; assigned_court integer;
BEGIN
  IF p_live_status NOT IN ('available', 'playing', 'up_next') OR p_live_status IS NULL THEN RAISE EXCEPTION 'Invalid live status'; END IF;
  SELECT * INTO target FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match was not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sdsap_live_queue:' || target.season_id::text, 0));
  SELECT * INTO target FROM public.matches WHERE id = p_match_id FOR UPDATE;
  SELECT status, live_court_count INTO season_status, configured_courts FROM public.seasons WHERE id = target.season_id FOR UPDATE;
  IF target.status <> 'scheduled' OR season_status <> 'active' THEN RAISE EXCEPTION 'Only an unplayed match in an active season can use the live queue'; END IF;
  IF p_live_status = 'playing' THEN
    SELECT court INTO assigned_court FROM generate_series(1, configured_courts) AS court WHERE NOT EXISTS (
      SELECT 1 FROM public.matches WHERE season_id = target.season_id AND status = 'scheduled'
        AND live_status = 'playing' AND live_court_number = court AND id <> p_match_id) ORDER BY court LIMIT 1;
    IF assigned_court IS NULL THEN RAISE EXCEPTION 'All configured courts are currently occupied'; END IF;
  ELSIF p_live_status = 'up_next' THEN
    UPDATE public.matches SET live_status = 'available', live_court_number = NULL
      WHERE season_id = target.season_id AND status = 'scheduled' AND live_status = 'up_next' AND id <> p_match_id;
  END IF;
  UPDATE public.matches SET live_status = p_live_status,
    live_court_number = CASE WHEN p_live_status = 'playing' THEN assigned_court ELSE NULL END WHERE id = p_match_id;
END;
$$;

-- Attendance safeguards also apply to direct writes, and only affected games.
CREATE FUNCTION public.guard_league_player_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.is_present AND NOT NEW.is_present THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('sdsap_live_queue:' || OLD.season_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.matches AS match WHERE match.season_id = OLD.season_id
      AND match.status = 'scheduled' AND match.live_status = 'playing'
      AND OLD.pool_player_id = ANY(public.league_match_participant_ids(match))) THEN
      RAISE EXCEPTION 'This player is currently in the match on court';
    END IF;
    UPDATE public.matches AS match SET live_status = 'available', live_court_number = NULL
      WHERE match.season_id = OLD.season_id AND match.status = 'scheduled' AND match.live_status = 'up_next'
        AND OLD.pool_player_id = ANY(public.league_match_participant_ids(match));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER players_guard_attendance BEFORE UPDATE OF is_present ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.guard_league_player_attendance();
CREATE OR REPLACE FUNCTION public.set_player_presence(p_player_id uuid, p_is_present boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.players AS player JOIN public.seasons AS season ON season.id = player.season_id
    WHERE player.id = p_player_id AND season.status = 'active') THEN RAISE EXCEPTION 'Attendance can only be changed for the active season'; END IF;
  UPDATE public.players SET is_present = p_is_present WHERE id = p_player_id;
END;
$$;

REVOKE ALL ON FUNCTION public.league_duel_rating_snapshot(uuid), public.league_duel_schedule(integer),
  public.validate_league_duel_season(uuid), public.set_season_format_atomic(uuid, text),
  public.save_league_duel_draft_atomic(uuid, jsonb, bigint, text), public.generate_league_duel_matches_atomic(uuid),
  public.league_match_participant_ids(public.matches) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.league_duel_rating_snapshot(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_duel_schedule(integer), public.validate_league_duel_season(uuid),
  public.set_season_format_atomic(uuid, text), public.save_league_duel_draft_atomic(uuid, jsonb, bigint, text),
  public.generate_league_duel_matches_atomic(uuid), public.league_match_participant_ids(public.matches) TO authenticated;
REVOKE ALL ON FUNCTION public.check_league_duel_schedule(), public.guard_league_duel_roster(),
  public.guard_league_season_format(), public.guard_league_duel_match(), public.guard_league_player_attendance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_league_duel_schedule(), public.guard_league_duel_roster(),
  public.guard_league_season_format(), public.guard_league_duel_match(), public.guard_league_player_attendance() TO authenticated;
