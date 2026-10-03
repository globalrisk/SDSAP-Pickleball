-- Additive scheduling metadata. NULL retains the historical mirror rules.
-- No season, roster, fixture, result, or rating row is rewritten here.
ALTER TABLE public.players ADD COLUMN duel_tier text CHECK (duel_tier IN ('top', 'middle', 'bottom'));
ALTER TABLE public.seasons ADD COLUMN duel_schedule_mode text CHECK (duel_schedule_mode = 'tier_matched');

CREATE FUNCTION public.league_duel_rank_tier(p_rank integer, p_size integer)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN p_size NOT BETWEEN 4 AND 7 OR p_rank NOT BETWEEN 1 AND p_size THEN NULL
    WHEN p_rank <= p_size / 3 THEN 'top'
    WHEN p_rank <= p_size - p_size / 3 THEN 'middle' ELSE 'bottom' END;
$$;

CREATE FUNCTION public.league_duel_roster_tiers(p_season_id uuid)
RETURNS TABLE(pool_player_id uuid, tier text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT ranked.pool_player_id, public.league_duel_rank_tier(((position + 1) / 2)::integer, (total / 2)::integer)
  FROM (
    SELECT roster.pool_player_id, row_number() OVER (ORDER BY member.rating DESC, roster.pool_player_id) AS position,
      count(*) OVER () AS total
    FROM public.season_roster AS roster JOIN public.seasons AS season ON season.id = roster.season_id
    JOIN public.league_players AS member ON member.league_id = season.league_id AND member.pool_player_id = roster.pool_player_id
    WHERE roster.season_id = p_season_id
  ) AS ranked;
$$;

CREATE FUNCTION public.league_duel_partner_history(p_season_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE target public.seasons; history jsonb;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required'; END IF;
  SELECT * INTO target FROM public.seasons WHERE id = p_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Season was not found'; END IF;
  WITH previous AS (
    SELECT id, starts_at, format FROM public.seasons
    WHERE league_id = target.league_id AND (starts_at, id) < (target.starts_at, target.id)
    ORDER BY starts_at DESC, id DESC LIMIT 3
  ), sides AS (
    SELECT previous.id AS season_id, CASE WHEN cardinality(side.ids) = 2 THEN side.ids
      WHEN previous.format = 'round_robin' AND COALESCE(cardinality(side.ids), 0) = 0
        THEN ARRAY(SELECT player.pool_player_id FROM public.players AS player WHERE player.team_id = side.team_id ORDER BY player.pool_player_id)
      ELSE ARRAY[]::uuid[] END AS ids
    FROM previous JOIN public.matches AS match ON match.season_id = previous.id
    CROSS JOIN LATERAL (VALUES (match.home_team_id, match.home_pool_player_ids), (match.away_team_id, match.away_pool_player_ids)) AS side(team_id, ids)
    WHERE match.status = 'completed'
  ), pairs AS (
    SELECT DISTINCT season_id, LEAST(ids[1], ids[2]) AS first_id, GREATEST(ids[1], ids[2]) AS second_id
    FROM sides WHERE cardinality(ids) = 2 AND ids[1] IS NOT NULL AND ids[2] IS NOT NULL AND ids[1] <> ids[2]
  ), partnerships AS (
    SELECT first_id, second_id, array_agg(season_id ORDER BY season_id) AS season_ids
    FROM pairs GROUP BY first_id, second_id
  )
  SELECT jsonb_build_object('leagueId', target.league_id,
    'seasonIds', COALESCE((SELECT jsonb_agg(id ORDER BY starts_at DESC, id DESC) FROM previous), '[]'::jsonb),
    'partnerships', COALESCE((SELECT jsonb_agg(jsonb_build_object('poolPlayerIds', ARRAY[first_id, second_id], 'seasonIds', season_ids)
      ORDER BY first_id, second_id) FROM partnerships), '[]'::jsonb)) INTO history;
  RETURN history;
END;
$$;

ALTER FUNCTION public.validate_league_duel_season(uuid) RENAME TO validate_league_duel_mirror_season;
CREATE FUNCTION public.validate_league_duel_season(p_season_id uuid)
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
    SELECT 1 FROM public.matches AS match CROSS JOIN LATERAL unnest(public.league_match_participant_ids(match)) AS participant(id)
    WHERE match.season_id = p_season_id GROUP BY match.round_number, participant.id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM public.players AS first JOIN public.players AS second ON second.team_id = first.team_id AND second.pool_player_id > first.pool_player_id
    WHERE first.season_id = p_season_id AND NOT EXISTS (
      SELECT 1 FROM public.matches AS match WHERE match.season_id = p_season_id AND
        ((match.home_team_id = first.team_id AND ARRAY[first.pool_player_id, second.pool_player_id] <@ match.home_pool_player_ids)
         OR (match.away_team_id = first.team_id AND ARRAY[first.pool_player_id, second.pool_player_id] <@ match.away_pool_player_ids))
    )
  ) THEN RAISE EXCEPTION 'Team Duel schedule requires every partnership once on both sides and conflict-free complete rounds' USING ERRCODE = '23514'; END IF;
END;
$$;

CREATE FUNCTION public.validate_league_duel_draft_ratings(p_season_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT player.duel_rank, player.duel_tier, member.status, tiers.tier,
        row_number() OVER (PARTITION BY player.team_id ORDER BY member.rating DESC, player.pool_player_id) AS current_rank
      FROM public.players AS player JOIN public.seasons AS season ON season.id = player.season_id
      LEFT JOIN public.league_players AS member ON member.league_id = season.league_id AND member.pool_player_id = player.pool_player_id
      LEFT JOIN public.league_duel_roster_tiers(p_season_id) AS tiers ON tiers.pool_player_id = player.pool_player_id
      WHERE player.season_id = p_season_id
    ) AS ranked WHERE duel_rank IS DISTINCT FROM current_rank OR duel_tier IS DISTINCT FROM tier OR status IS DISTINCT FROM 'active'
  ) THEN RAISE EXCEPTION 'DUEL_STALE_DRAFT: Squad ranks or tiers changed. Refresh and save draft options first.' USING ERRCODE = '40001'; END IF;
END;
$$;

DROP FUNCTION public.generate_league_duel_matches_atomic(uuid);
CREATE FUNCTION public.generate_league_duel_matches_atomic(
  p_season_id uuid, p_matches jsonb, p_expected_rating_revision bigint, p_expected_rating_fingerprint text
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

REVOKE ALL ON FUNCTION public.league_duel_rank_tier(integer, integer), public.league_duel_roster_tiers(uuid),
  public.league_duel_partner_history(uuid), public.validate_league_duel_season(uuid), public.validate_league_duel_draft_ratings(uuid),
  public.generate_league_duel_matches_atomic(uuid, jsonb, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.league_duel_rank_tier(integer, integer), public.league_duel_roster_tiers(uuid),
  public.league_duel_partner_history(uuid), public.validate_league_duel_season(uuid), public.validate_league_duel_draft_ratings(uuid),
  public.generate_league_duel_matches_atomic(uuid, jsonb, bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_league_duel_draft_atomic(
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
  UPDATE public.seasons SET duel_schedule_mode = 'tier_matched', duel_draft_rating_revision = p_expected_rating_revision,
    duel_draft_rating_fingerprint = p_expected_rating_fingerprint WHERE id = p_season_id;
  PERFORM public.validate_league_duel_season(p_season_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_league_duel_roster()
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
      immutable_change := (NEW.team_id, NEW.season_id, NEW.pool_player_id, NEW.duel_rank, NEW.duel_tier)
        IS DISTINCT FROM (OLD.team_id, OLD.season_id, OLD.pool_player_id, OLD.duel_rank, OLD.duel_tier);
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

CREATE OR REPLACE FUNCTION public.guard_league_season_format()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.duel_schedule_mode IS DISTINCT FROM OLD.duel_schedule_mode AND EXISTS (
    SELECT 1 FROM public.matches WHERE season_id = OLD.id
  ) THEN RAISE EXCEPTION 'Team Duel schedule mode is frozen after generation' USING ERRCODE = '23514'; END IF;
  IF NEW.format IS DISTINCT FROM OLD.format THEN
    IF OLD.status <> 'active' OR EXISTS (SELECT 1 FROM public.matches WHERE season_id = OLD.id) THEN
      RAISE EXCEPTION 'Season format is locked after schedule generation';
    END IF;
    DELETE FROM public.teams WHERE season_id = OLD.id;
    NEW.duel_schedule_mode := NULL; NEW.duel_draft_rating_revision := NULL; NEW.duel_draft_rating_fingerprint := NULL;
  END IF;
  IF NEW.league_id IS DISTINCT FROM OLD.league_id AND
    (OLD.format = 'team_duel' OR NEW.format = 'team_duel') THEN RAISE EXCEPTION 'Team Duel cannot be moved to another league'; END IF;
  IF OLD.format = 'team_duel' AND NEW.status = 'archived' AND EXISTS (
    SELECT 1 FROM public.matches WHERE season_id = OLD.id AND status = 'scheduled'
  ) THEN RAISE EXCEPTION 'Resolve every Team Duel game before completing the season'; END IF;
  RETURN NEW;
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
      OR EXISTS (SELECT 1 FROM public.players WHERE team_id = target AND (duel_rank IS NOT NULL OR duel_tier IS NOT NULL)) THEN
      RAISE EXCEPTION 'Round-robin teams must have exactly two players without duel ranks' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_league_duel_match()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE season_format text; mode text; home_tiers text[]; away_tiers text[]; home_ranks integer[]; away_ranks integer[];
BEGIN
  SELECT format, duel_schedule_mode INTO season_format, mode FROM public.seasons WHERE id = COALESCE(NEW.season_id, OLD.season_id) FOR UPDATE;
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
