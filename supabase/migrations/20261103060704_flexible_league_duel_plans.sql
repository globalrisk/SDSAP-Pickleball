-- New drafts opt in; no stored squad, fixture, result, or rating is rewritten.
ALTER TABLE public.seasons DROP CONSTRAINT seasons_duel_schedule_mode_check;
ALTER TABLE public.seasons ADD CONSTRAINT seasons_duel_schedule_mode_check CHECK (duel_schedule_mode IN ('tier_matched', 'flexible'));
ALTER TABLE public.seasons ADD COLUMN duel_draft_plan jsonb, ADD COLUMN duel_draft_plan_hash text;

-- Same complementary-error approximation used by ts-gaussian / ts-trueskill.
CREATE FUNCTION public.duel_standard_normal_cdf(p_z double precision)
RETURNS double precision LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE x double precision := -p_z / sqrt(2.0); z double precision; t double precision; r double precision;
BEGIN
  z := abs(x); t := 1 / (1 + z / 2);
  r := t * exp(-z*z - 1.26551223 + t*(1.00002368 + t*(0.37409196 + t*(0.09678418 + t*(-0.18628806 + t*(0.27886807 + t*(-1.13520398 + t*(1.48851587 + t*(-0.82215223 + t*0.17087277)))))))));
  RETURN 0.5 * CASE WHEN x >= 0 THEN r ELSE 2-r END;
END;
$$;

CREATE FUNCTION public.validate_flexible_duel_plan(p_season_id uuid, p_plan jsonb, p_check_ratings boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; roster uuid[]; ids uuid[]; home_ids uuid[]; away_ids uuid[]; all_ids uuid[]; size integer;
  games jsonb; game jsonb; fixture_count integer; rounds integer; partner_cap integer; opponent_cap integer;
  ordered uuid[]; h uuid[]; a uuid[]; i integer := 0; k integer; p double precision; delta double precision; variance double precision;
  distribution double precision[]; home_chance double precision := 0; away_chance double precision := 0;
BEGIN
  SELECT league_id INTO league FROM public.seasons WHERE id = p_season_id;
  SELECT array_agg(pool_player_id ORDER BY pool_player_id) INTO roster FROM public.season_roster WHERE season_id = p_season_id;
  size := cardinality(roster) / 2; fixture_count := size*(size-1)/2; rounds := size-1+size%2;
  IF size IS NULL OR cardinality(roster) NOT IN (8,10,12,14) OR p_plan IS NULL OR (p_plan->>'version')::integer IS DISTINCT FROM 1
    OR jsonb_typeof(p_plan->'squads') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'squads') <> 2
    OR jsonb_typeof(p_plan->'settings') IS DISTINCT FROM 'object'
    OR NOT (p_plan->'settings' ?& ARRAY['maxPartnerMeetings','maxOpponentMeetings']) THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Invalid roster, planner version, or settings' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(value::uuid ORDER BY ordinality) INTO home_ids FROM jsonb_array_elements_text(p_plan->'squads'->0) WITH ORDINALITY;
  SELECT array_agg(value::uuid ORDER BY ordinality) INTO away_ids FROM jsonb_array_elements_text(p_plan->'squads'->1) WITH ORDINALITY;
  all_ids := home_ids || away_ids;
  IF cardinality(home_ids) IS DISTINCT FROM size OR cardinality(away_ids) IS DISTINCT FROM size
    OR (SELECT count(DISTINCT id) FROM unnest(all_ids) id) <> size*2
    OR (SELECT array_agg(id ORDER BY id) FROM unnest(all_ids) id) IS DISTINCT FROM roster THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Squads must cover the roster exactly once' USING ERRCODE='23514';
  END IF;
  partner_cap := COALESCE((p_plan->'settings'->>'maxPartnerMeetings')::integer,size-1);
  opponent_cap := COALESCE((p_plan->'settings'->>'maxOpponentMeetings')::integer,size-1);
  IF partner_cap NOT BETWEEN 1 AND size-1 OR opponent_cap NOT BETWEEN 1 AND size-1 OR opponent_cap*size < 2*(size-1) THEN
    RAISE EXCEPTION 'DUEL_INVALID_LIMIT: Invalid or impossible repeat limits' USING ERRCODE='23514';
  END IF;
  games := p_plan->'option'->'games';
  IF jsonb_typeof(games) IS DISTINCT FROM 'array' OR jsonb_array_length(games) <> fixture_count THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: A complete fixture list is required' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(games) g WHERE
    jsonb_typeof(g->'homePoolPlayerIds') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'homePoolPlayerIds') <> 2
    OR jsonb_typeof(g->'awayPoolPlayerIds') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'awayPoolPlayerIds') <> 2
    OR (g->>'roundNumber')::integer IS NULL OR (g->>'roundNumber')::integer NOT BETWEEN 1 AND rounds
    OR (g->>'sequenceNumber')::integer IS NULL OR (g->>'sequenceNumber')::integer NOT BETWEEN 1 AND fixture_count)
    OR (SELECT count(DISTINCT (g->>'sequenceNumber')::integer) FROM jsonb_array_elements(games) g) <> fixture_count
    OR (SELECT count(DISTINCT (g->>'roundNumber')::integer) FROM jsonb_array_elements(games) g) <> rounds
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(games) g GROUP BY g->>'roundNumber' HAVING count(*) <> size/2) THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Invalid rounds or sequence numbers' USING ERRCODE='23514';
  END IF;
  FOR game IN SELECT value FROM jsonb_array_elements(games) LOOP
    SELECT array_agg(value::uuid) INTO h FROM jsonb_array_elements_text(game->'homePoolPlayerIds');
    SELECT array_agg(value::uuid) INTO a FROM jsonb_array_elements_text(game->'awayPoolPlayerIds');
    IF NOT h <@ home_ids OR NOT a <@ away_ids OR (SELECT count(DISTINCT id) FROM unnest(h||a) id) <> 4 THEN
      RAISE EXCEPTION 'DUEL_INVALID_PLAN: Four distinct squad participants are required' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(games) g CROSS JOIN LATERAL jsonb_array_elements_text((g->'homePoolPlayerIds') || (g->'awayPoolPlayerIds')) player
    GROUP BY g->>'roundNumber',player.value HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM unnest(all_ids) player(id) WHERE (SELECT count(*) FROM jsonb_array_elements(games) g
      WHERE (g->'homePoolPlayerIds') ? player.id::text OR (g->'awayPoolPlayerIds') ? player.id::text) <> size-1
  ) THEN RAISE EXCEPTION 'DUEL_INVALID_PLAN: Unequal participation or double booking' USING ERRCODE='23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(games) g CROSS JOIN LATERAL (VALUES(g->'homePoolPlayerIds'),(g->'awayPoolPlayerIds')) side(ids)
    GROUP BY LEAST(side.ids->>0,side.ids->>1),GREATEST(side.ids->>0,side.ids->>1) HAVING count(*) > partner_cap
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(games) g CROSS JOIN LATERAL jsonb_array_elements_text(g->'homePoolPlayerIds') h
      CROSS JOIN LATERAL jsonb_array_elements_text(g->'awayPoolPlayerIds') a GROUP BY h.value,a.value HAVING count(*) > opponent_cap
  ) THEN RAISE EXCEPTION 'DUEL_REPEAT_LIMIT: Repeat limits exceeded' USING ERRCODE='23514'; END IF;
  IF NOT p_check_ratings THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM unnest(all_ids) player(id) LEFT JOIN public.league_players lp ON lp.league_id=league AND lp.pool_player_id=player.id
    WHERE lp.status IS DISTINCT FROM 'active' OR lp.rating::text IN ('NaN','Infinity','-Infinity')
      OR lp.rating_deviation < 0 OR lp.rating_deviation::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'DUEL_INVALID_PLAN: Active rated players are required' USING ERRCODE='23514';
  END IF;
  FOREACH ids SLICE 1 IN ARRAY ARRAY[home_ids,away_ids] LOOP
    SELECT array_agg(pool_player_id ORDER BY rating DESC,pool_player_id) INTO ordered FROM public.league_players WHERE league_id=league AND pool_player_id=ANY(ids);
    IF ids IS DISTINCT FROM ordered THEN RAISE EXCEPTION 'DUEL_STALE_DRAFT: Squad ranks changed' USING ERRCODE='40001'; END IF;
  END LOOP;
  distribution := array_fill(0.0::double precision, ARRAY[fixture_count+1], ARRAY[0]); distribution[0] := 1;
  FOR game IN SELECT value FROM jsonb_array_elements(games) ORDER BY (value->>'sequenceNumber')::integer LOOP
    SELECT sum(CASE WHEN (game->'homePoolPlayerIds') ? lp.pool_player_id::text THEN lp.rating ELSE -lp.rating END), sum(lp.rating_deviation*lp.rating_deviation)
      INTO delta,variance FROM public.league_players lp WHERE lp.league_id=league AND
        ((game->'homePoolPlayerIds') ? lp.pool_player_id::text OR (game->'awayPoolPlayerIds') ? lp.pool_player_id::text);
    p := public.duel_standard_normal_cdf(delta / sqrt(250000.0+variance)); i := i+1;
    FOR k IN REVERSE i..0 LOOP
      distribution[k] := distribution[k]*(1-p) + CASE WHEN k>0 THEN distribution[k-1]*p ELSE 0 END;
    END LOOP;
  END LOOP;
  FOR k IN 0..fixture_count LOOP
    IF 2*k>fixture_count THEN home_chance:=home_chance+distribution[k];
    ELSIF 2*k<fixture_count THEN away_chance:=away_chance+distribution[k]; END IF;
  END LOOP;
  IF GREATEST(home_chance,away_chance)/(home_chance+away_chance) > 0.55+1e-12 THEN
    RAISE EXCEPTION 'DUEL_SEASON_BALANCE: Season favorite exceeds 55%%' USING ERRCODE='23514';
  END IF;
END;
$$;

ALTER FUNCTION public.validate_league_duel_season(uuid) RENAME TO validate_league_duel_legacy_season;
CREATE FUNCTION public.validate_league_duel_season(p_season_id uuid)
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
        AND m.home_pool_player_ids=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(g->'homePoolPlayerIds'))
        AND m.away_pool_player_ids=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(g->'awayPoolPlayerIds'))
        AND EXISTS(SELECT 1 FROM public.players p WHERE p.team_id=m.home_team_id AND p.pool_player_id=m.home_pool_player_ids[1])
        AND EXISTS(SELECT 1 FROM public.players p WHERE p.team_id=m.away_team_id AND p.pool_player_id=m.away_pool_player_ids[1])
    )) THEN RAISE EXCEPTION 'Generated fixtures must match the saved preview exactly' USING ERRCODE='23514'; END IF;
END;
$$;

ALTER FUNCTION public.validate_league_duel_draft_ratings(uuid) RENAME TO validate_league_duel_legacy_draft_ratings;
CREATE FUNCTION public.validate_league_duel_draft_ratings(p_season_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target public.seasons%ROWTYPE;
BEGIN
  SELECT * INTO target FROM public.seasons WHERE id=p_season_id;
  IF target.duel_schedule_mode IS DISTINCT FROM 'flexible' THEN PERFORM public.validate_league_duel_legacy_draft_ratings(p_season_id); RETURN; END IF;
  PERFORM public.validate_flexible_duel_plan(p_season_id,target.duel_draft_plan,true);
END;
$$;

CREATE FUNCTION public.guard_flexible_duel_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.duel_draft_plan,NEW.duel_draft_plan_hash) IS DISTINCT FROM (OLD.duel_draft_plan,OLD.duel_draft_plan_hash)
    AND EXISTS(SELECT 1 FROM public.matches WHERE season_id=OLD.id) THEN RAISE EXCEPTION 'Generated Team Duel plans are frozen' USING ERRCODE='23514'; END IF;
  IF NEW.format IS DISTINCT FROM OLD.format OR NEW.duel_draft_rating_revision IS NULL OR NEW.duel_draft_rating_fingerprint IS NULL OR NEW.duel_schedule_mode IS DISTINCT FROM 'flexible' THEN
    NEW.duel_draft_plan:=NULL; NEW.duel_draft_plan_hash:=NULL;
  ELSIF NEW.duel_draft_plan IS DISTINCT FROM OLD.duel_draft_plan THEN
    PERFORM public.validate_flexible_duel_plan(OLD.id,NEW.duel_draft_plan,true);
    NEW.duel_draft_plan_hash:=md5(NEW.duel_draft_plan::text);
  ELSE NEW.duel_draft_plan_hash:=OLD.duel_draft_plan_hash;
  END IF;
  RETURN NEW;
END;
$$;
-- Runs after the existing format guard; clearing fixtures invalidates the snapshot.
CREATE TRIGGER zzz_guard_flexible_duel_plan BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.guard_flexible_duel_plan();

CREATE FUNCTION public.save_league_duel_plan_atomic(
 p_season_id uuid,p_plan jsonb,p_names text[],p_expected_rating_revision bigint,p_expected_rating_fingerprint text,p_expected_plan_hash text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; target public.seasons%ROWTYPE; snapshot jsonb; side integer; player_id uuid; target_team uuid; rank integer; current_hash text;
BEGIN
  IF (SELECT auth.jwt()->'app_metadata'->>'role') IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Administrator access is required' USING ERRCODE='42501'; END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id=p_season_id;
  PERFORM 1 FROM public.rating_state WHERE league_id=league FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_season_setup:'||p_season_id::text,0));
  SELECT * INTO target FROM public.seasons WHERE id=p_season_id AND status='active' AND format='team_duel' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active Team Duel season first'; END IF;
  IF EXISTS(SELECT 1 FROM public.matches WHERE season_id=p_season_id) THEN RAISE EXCEPTION 'This season already has matches'; END IF;
  IF target.duel_draft_plan_hash IS DISTINCT FROM p_expected_plan_hash THEN RAISE EXCEPTION 'DUEL_STALE_DRAFT: Saved draft changed' USING ERRCODE='40001'; END IF;
  snapshot:=public.league_duel_rating_snapshot(league);
  IF (snapshot->>'revision')::bigint IS DISTINCT FROM p_expected_rating_revision OR snapshot->>'fingerprint' IS DISTINCT FROM p_expected_rating_fingerprint THEN
    RAISE EXCEPTION 'DUEL_STALE_DRAFT: Ratings changed' USING ERRCODE='40001'; END IF;
  IF cardinality(p_names) IS DISTINCT FROM 2 OR EXISTS(SELECT 1 FROM unnest(p_names) name WHERE name IS NULL OR btrim(name)='' OR length(btrim(name))>120) THEN
    RAISE EXCEPTION 'Two names of 1–120 characters are required' USING ERRCODE='23514'; END IF;
  PERFORM public.validate_flexible_duel_plan(p_season_id,p_plan,true);
  UPDATE public.seasons SET duel_schedule_mode='flexible',duel_draft_priority=NULL,duel_draft_plan=p_plan,
    duel_draft_rating_revision=p_expected_rating_revision,duel_draft_rating_fingerprint=p_expected_rating_fingerprint WHERE id=p_season_id;
  DELETE FROM public.teams WHERE season_id=p_season_id;
  FOR side IN 0..1 LOOP
    INSERT INTO public.teams(season_id,name,color) VALUES(p_season_id,btrim(p_names[side+1]),CASE WHEN side=0 THEN '#15803d' ELSE '#1d4ed8' END) RETURNING id INTO target_team;
    rank:=0;
    FOR player_id IN SELECT value::uuid FROM jsonb_array_elements_text(p_plan->'squads'->side) LOOP
      rank:=rank+1;
      INSERT INTO public.players(season_id,team_id,pool_player_id,name,duel_rank,duel_tier)
        SELECT p_season_id,target_team,id,name,rank,NULL FROM public.player_pool WHERE id=player_id;
    END LOOP;
  END LOOP;
  PERFORM public.validate_league_duel_season(p_season_id);
  SELECT duel_draft_plan_hash INTO current_hash FROM public.seasons WHERE id=p_season_id;
  RETURN jsonb_build_object('hash',current_hash,'count',0);
END;
$$;

CREATE FUNCTION public.save_and_generate_league_duel_plan_atomic(
 p_season_id uuid,p_plan jsonb,p_names text[],p_expected_rating_revision bigint,p_expected_rating_fingerprint text,p_expected_plan_hash text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved jsonb; home uuid; away uuid; inserted integer;
BEGIN
  saved:=public.save_league_duel_plan_atomic(p_season_id,p_plan,p_names,p_expected_rating_revision,p_expected_rating_fingerprint,p_expected_plan_hash);
  SELECT team_id INTO home FROM public.players WHERE season_id=p_season_id AND pool_player_id=(p_plan->'squads'->0->>0)::uuid;
  SELECT team_id INTO away FROM public.players WHERE season_id=p_season_id AND pool_player_id=(p_plan->'squads'->1->>0)::uuid;
  INSERT INTO public.matches(season_id,home_team_id,away_team_id,round_number,duel_sequence_number,home_pool_player_ids,away_pool_player_ids,status)
    SELECT p_season_id,home,away,(g->>'roundNumber')::integer,(g->>'sequenceNumber')::integer,
      ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(g->'homePoolPlayerIds')),
      ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(g->'awayPoolPlayerIds')),'scheduled'
    FROM jsonb_array_elements(p_plan->'option'->'games') g;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  PERFORM public.validate_league_duel_season(p_season_id);
  RETURN saved || jsonb_build_object('count',inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.duel_standard_normal_cdf(double precision),public.validate_flexible_duel_plan(uuid,jsonb,boolean),
 public.validate_league_duel_season(uuid),public.validate_league_duel_draft_ratings(uuid),public.guard_flexible_duel_plan(),
 public.save_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text),public.save_and_generate_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.duel_standard_normal_cdf(double precision),public.validate_flexible_duel_plan(uuid,jsonb,boolean),
 public.validate_league_duel_season(uuid),public.validate_league_duel_draft_ratings(uuid),public.guard_flexible_duel_plan(),
 public.save_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text),public.save_and_generate_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text) TO authenticated;
