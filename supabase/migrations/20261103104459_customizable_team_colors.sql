-- Custom colors are cosmetic; existing teams and results are preserved.
CREATE FUNCTION public.save_league_duel_plan_atomic(
 p_season_id uuid,p_plan jsonb,p_names text[],p_expected_rating_revision bigint,p_expected_rating_fingerprint text,p_expected_plan_hash text,p_colors text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE league uuid; target public.seasons%ROWTYPE; snapshot jsonb; side integer; player_id uuid; target_team uuid; rank integer; current_hash text; chosen_colors text[];
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
  IF p_colors IS NOT NULL THEN
    IF cardinality(p_colors) <> 2 OR EXISTS(SELECT 1 FROM unnest(p_colors) color WHERE color IS NULL OR color !~ '^#[0-9A-Fa-f]{6}$') THEN
      RAISE EXCEPTION 'Two valid team colors are required' USING ERRCODE='23514'; END IF;
    chosen_colors:=p_colors;
  ELSE
    -- A presentation edit must survive rebuilding the saved schedule.
    SELECT array_agg(coalesce(
      (SELECT t.color FROM public.teams t JOIN public.players p ON p.team_id=t.id
        WHERE t.season_id=p_season_id AND p.pool_player_id=(target.duel_draft_plan->'squads'->s.side_index->>0)::uuid),
      CASE WHEN s.side_index=0 THEN '#2563eb' ELSE '#ea580c' END) ORDER BY s.side_index)
      INTO chosen_colors FROM generate_series(0,1) s(side_index);
  END IF;
  PERFORM public.validate_flexible_duel_plan(p_season_id,p_plan,true);
  UPDATE public.seasons SET duel_schedule_mode='flexible',duel_draft_priority=NULL,duel_draft_plan=p_plan,
    duel_draft_rating_revision=p_expected_rating_revision,duel_draft_rating_fingerprint=p_expected_rating_fingerprint WHERE id=p_season_id;
  DELETE FROM public.teams WHERE season_id=p_season_id;
  FOR side IN 0..1 LOOP
    INSERT INTO public.teams(season_id,name,color) VALUES(p_season_id,btrim(p_names[side+1]),chosen_colors[side+1]) RETURNING id INTO target_team;
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
 p_season_id uuid,p_plan jsonb,p_names text[],p_expected_rating_revision bigint,p_expected_rating_fingerprint text,p_expected_plan_hash text,p_colors text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved jsonb; home uuid; away uuid; inserted integer;
BEGIN
  saved:=public.save_league_duel_plan_atomic(p_season_id,p_plan,p_names,p_expected_rating_revision,p_expected_rating_fingerprint,p_expected_plan_hash,p_colors);
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

-- Keep existing signatures working for older clients and schedule generation.
CREATE OR REPLACE FUNCTION public.save_league_duel_plan_atomic(
 p_season_id uuid,p_plan jsonb,p_names text[],p_expected_rating_revision bigint,p_expected_rating_fingerprint text,p_expected_plan_hash text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT public.save_league_duel_plan_atomic(p_season_id,p_plan,p_names,p_expected_rating_revision,p_expected_rating_fingerprint,p_expected_plan_hash,NULL::text[]);
$$;
CREATE OR REPLACE FUNCTION public.save_and_generate_league_duel_plan_atomic(
 p_season_id uuid,p_plan jsonb,p_names text[],p_expected_rating_revision bigint,p_expected_rating_fingerprint text,p_expected_plan_hash text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT public.save_and_generate_league_duel_plan_atomic(p_season_id,p_plan,p_names,p_expected_rating_revision,p_expected_rating_fingerprint,p_expected_plan_hash,NULL::text[]);
$$;
REVOKE ALL ON FUNCTION public.save_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text,text[]),
 public.save_and_generate_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text,text[]),
 public.save_and_generate_league_duel_plan_atomic(uuid,jsonb,text[],bigint,text,text,text[]) TO authenticated;
