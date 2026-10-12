-- Prizes are separate from ratings and competition points. Numeric values cross
-- the API as text, avoiding floating-point arithmetic in clients.
CREATE TABLE public.pickle_league_settings (
  league_id uuid PRIMARY KEY REFERENCES public.leagues(id) ON DELETE CASCADE,
  match_prize numeric NOT NULL DEFAULT 0 CHECK (match_prize BETWEEN 0 AND 1000000000000 AND mod(match_prize, 1000) = 0),
  champion_prize numeric NOT NULL DEFAULT 0 CHECK (champion_prize BETWEEN 0 AND 1000000000000 AND mod(champion_prize, 1000) = 0)
);
CREATE TABLE public.pickle_season_settings (
  season_id uuid PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  match_prize numeric NOT NULL DEFAULT 0 CHECK (match_prize BETWEEN 0 AND 1000000000000 AND mod(match_prize, 1000) = 0),
  champion_prize numeric NOT NULL DEFAULT 0 CHECK (champion_prize BETWEEN 0 AND 1000000000000 AND mod(champion_prize, 1000) = 0),
  configured boolean NOT NULL DEFAULT false
);
CREATE TABLE public.pickle_awards (
  season_id uuid PRIMARY KEY REFERENCES public.seasons(id) ON DELETE RESTRICT,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE RESTRICT,
  awarded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  receipt jsonb NOT NULL
);
CREATE INDEX pickle_awards_league_idx ON public.pickle_awards(league_id);
CREATE INDEX pickle_awards_admin_idx ON public.pickle_awards(awarded_by);
CREATE TABLE public.pickle_allocations (
  season_id uuid NOT NULL REFERENCES public.pickle_awards(season_id) ON DELETE RESTRICT,
  pool_player_id uuid NOT NULL REFERENCES public.player_pool(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  amount numeric(24,6) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (season_id, pool_player_id)
);
CREATE INDEX pickle_allocations_player_idx ON public.pickle_allocations(pool_player_id);
CREATE INDEX pickle_allocations_team_idx ON public.pickle_allocations(team_id);

DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['pickle_league_settings', 'pickle_season_settings', 'pickle_awards', 'pickle_allocations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', tab);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', tab);
    EXECUTE format('CREATE POLICY public_read ON public.%I FOR SELECT TO anon, authenticated USING (true)', tab);
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['pickle_league_settings', 'pickle_season_settings'] LOOP
    EXECUTE format('GRANT INSERT, UPDATE ON public.%I TO authenticated', tab);
    EXECUTE format('CREATE POLICY admin_settings ON public.%I FOR ALL TO authenticated USING ((select auth.jwt()->''app_metadata''->>''role'') = ''admin'') WITH CHECK ((select auth.jwt()->''app_metadata''->>''role'') = ''admin'')', tab);
  END LOOP;
END $$;

INSERT INTO public.pickle_season_settings(season_id) SELECT id FROM public.seasons;
CREATE FUNCTION public.copy_pickle_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.pickle_season_settings(season_id, match_prize, champion_prize)
    SELECT NEW.id, COALESCE(s.match_prize, 0), COALESCE(s.champion_prize, 0)
    FROM (SELECT 1) AS singleton LEFT JOIN public.pickle_league_settings s ON s.league_id = NEW.league_id;
  RETURN NEW;
END $$;
CREATE TRIGGER copy_pickle_defaults AFTER INSERT ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.copy_pickle_defaults();

-- All edits relevant to awards take the rating lock before the season lock.
-- Finalization never locks match rows: an in-flight direct match write can
-- finish before finalization, or waits and is rejected after the receipt exists.
CREATE FUNCTION public.guard_pickle_source() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target uuid; old_target uuid; league uuid; state text;
BEGIN
  IF TG_TABLE_NAME = 'seasons' THEN
    target := COALESCE(NEW.id, OLD.id);
    old_target := target;
  ELSE
    target := COALESCE(NEW.season_id, OLD.season_id);
    old_target := CASE WHEN TG_OP <> 'INSERT' THEN OLD.season_id ELSE target END;
  END IF;
  FOR target IN SELECT DISTINCT id FROM unnest(ARRAY[target, old_target]) AS id ORDER BY id LOOP
    SELECT league_id INTO league FROM public.seasons WHERE id = target;
    IF league IS NULL THEN CONTINUE; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:' || league::text, 0));
    IF TG_TABLE_NAME <> 'seasons' THEN
      SELECT status INTO state FROM public.seasons WHERE id = target FOR UPDATE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.pickle_awards WHERE season_id = target) THEN
      -- Shared identity renames synchronize display names in historical rosters.
      IF TG_TABLE_NAME = 'players' AND TG_OP = 'UPDATE' AND
        (to_jsonb(NEW) - 'name') = (to_jsonb(OLD) - 'name') THEN RETURN NEW; END IF;
      -- Award receipt is inserted immediately before the first archive update.
      IF TG_TABLE_NAME = 'seasons' AND TG_OP = 'UPDATE' AND to_jsonb(OLD)->>'status' = 'active'
        AND to_jsonb(NEW)->>'status' = 'archived' AND
        (to_jsonb(NEW) - 'status' - 'ends_at') = (to_jsonb(OLD) - 'status' - 'ends_at') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'PICKLE_FINAL: Awarded season results, roster and settings are final' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'seasons' AND TG_OP = 'UPDATE' AND to_jsonb(OLD)->>'status' = 'active'
    AND to_jsonb(NEW)->>'status' = 'archived' AND to_jsonb(OLD)->>'format' = 'team_duel' THEN
    RAISE EXCEPTION 'PICKLE_ARCHIVE_RPC: Archive Team Duel through archive_season_with_pickle_points' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER aa_guard_pickle_season BEFORE UPDATE OR DELETE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.guard_pickle_source();
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['matches', 'players', 'teams', 'season_roster', 'pickle_season_settings'] LOOP
    EXECUTE format('CREATE TRIGGER aa_guard_pickle_source BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_pickle_source()', tab);
  END LOOP;
END $$;

CREATE FUNCTION public.immutable_pickle_award() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'PICKLE_FINAL: Pickle point awards are immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER immutable_pickle_award BEFORE UPDATE OR DELETE ON public.pickle_awards
  FOR EACH ROW EXECUTE FUNCTION public.immutable_pickle_award();
CREATE TRIGGER immutable_pickle_allocation BEFORE UPDATE OR DELETE ON public.pickle_allocations
  FOR EACH ROW EXECUTE FUNCTION public.immutable_pickle_award();

CREATE FUNCTION public.pickle_settings(p_league_id uuid, p_season_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'defaults', jsonb_build_object('matchPrize', COALESCE(l.match_prize,0)::text, 'championPrize', COALESCE(l.champion_prize,0)::text),
    'season', CASE WHEN s.season_id IS NULL THEN NULL ELSE jsonb_build_object(
      'matchPrize',s.match_prize::text,'championPrize',s.champion_prize::text,'configured',s.configured) END)
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.pickle_league_settings l ON l.league_id = p_league_id
  LEFT JOIN public.pickle_season_settings s ON s.season_id = p_season_id
    AND EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id AND league_id = p_league_id);
$$;

-- Single source of truth for normal previews, archiving and Season 13 bootstrap.
-- Override parameters are private, never a general-purpose award endpoint.
CREATE FUNCTION public.calculate_pickle_preview(p_season_id uuid, p_match_prize numeric DEFAULT NULL, p_champion_prize numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE season public.seasons; settings public.pickle_season_settings; squads jsonb; fixtures jsonb;
  total integer; remaining integer; valid boolean; complete boolean; max_wins integer; champions integer;
  result jsonb; match_prize numeric; champion_prize numeric;
BEGIN
  SELECT * INTO season FROM public.seasons WHERE id = p_season_id;
  IF NOT FOUND OR season.format <> 'team_duel' THEN RAISE EXCEPTION 'PICKLE_FORMAT: A league Team Duel season is required'; END IF;
  SELECT * INTO settings FROM public.pickle_season_settings WHERE season_id = p_season_id;
  match_prize := COALESCE(p_match_prize, settings.match_prize, 0);
  champion_prize := COALESCE(p_champion_prize, settings.champion_prize, 0);
  IF NOT (match_prize BETWEEN 0 AND 1000000000000 AND mod(match_prize,1000)=0
    AND champion_prize BETWEEN 0 AND 1000000000000 AND mod(champion_prize,1000)=0) THEN
    RAISE EXCEPTION 'PICKLE_AMOUNT: Prizes must be nonnegative multiples of 1000, up to 1000000000000';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'scheduled'),
    COALESCE(bool_and(status = 'scheduled' OR (winner_team_id IS NOT NULL AND winner_team_id IN (home_team_id,away_team_id))),true),
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'status',status,'winner',winner_team_id,'home',home_team_id,
      'away',away_team_id,'homeScore',home_score,'awayScore',away_score,'homePlayers',home_pool_player_ids,
      'awayPlayers',away_pool_player_ids,'recordedAt',result_recorded_at) ORDER BY id),'[]')
    INTO total,remaining,valid,fixtures FROM public.matches WHERE season_id = p_season_id;
  complete := total > 0 AND remaining = 0 AND valid;
  SELECT max(wins) INTO max_wins FROM (
    SELECT (SELECT count(*) FROM public.matches m WHERE m.season_id = p_season_id AND m.status <> 'scheduled' AND m.winner_team_id = t.id) AS wins
    FROM public.teams t WHERE t.season_id = p_season_id) scores;
  SELECT count(*) INTO champions FROM public.teams t WHERE t.season_id = p_season_id AND
    (SELECT count(*) FROM public.matches m WHERE m.season_id = p_season_id AND m.status <> 'scheduled' AND m.winner_team_id = t.id) = max_wins;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'wins',t.wins,
    'matchTotal',(t.wins * match_prize)::text,
    'championTotal',CASE WHEN complete THEN (CASE WHEN t.wins=max_wins THEN champion_prize / NULLIF(champions,0) ELSE 0 END)::text ELSE NULL END,
    'total',(t.wins * match_prize + CASE WHEN complete AND t.wins=max_wins THEN champion_prize / NULLIF(champions,0) ELSE 0 END)::text,
    'memberCount',jsonb_array_length(t.members),'members',t.members,
    'share',round((t.wins * match_prize + CASE WHEN complete AND t.wins=max_wins THEN champion_prize / NULLIF(champions,0) ELSE 0 END) / NULLIF(jsonb_array_length(t.members),0),6)::text
  ) ORDER BY t.id),'[]') INTO squads FROM (
    SELECT team.id,team.name,
      (SELECT count(*) FROM public.matches m WHERE m.season_id=p_season_id AND m.status <> 'scheduled' AND m.winner_team_id=team.id) wins,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.pool_player_id,'name',pool.name) ORDER BY p.pool_player_id)
        FROM public.players p JOIN public.player_pool pool ON pool.id=p.pool_player_id WHERE p.team_id=team.id),'[]') members
    FROM public.teams team WHERE team.season_id=p_season_id
  ) t;
  result := jsonb_build_object('seasonId',season.id,'seasonName',season.name,'leagueId',season.league_id,
    'matchPrize',match_prize::text,'championPrize',champion_prize::text,
    'configured',COALESCE(settings.configured,false) OR p_match_prize IS NOT NULL,
    'complete',complete,'valid',valid,'remaining',remaining,'totalMatches',total,'squads',squads);
  RETURN result || jsonb_build_object('fingerprint',md5((result || jsonb_build_object('fixtures',fixtures))::text));
END $$;

CREATE FUNCTION public.pickle_season_preview(p_season_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE receipt jsonb;
BEGIN
  SELECT a.receipt INTO receipt FROM public.pickle_awards a WHERE season_id=p_season_id;
  IF FOUND THEN RETURN receipt || jsonb_build_object('awarded',true); END IF;
  RETURN public.calculate_pickle_preview(p_season_id) || jsonb_build_object('awarded',false);
END $$;

-- Private writer; called only by the authenticated admin entry points below.
CREATE FUNCTION public.write_pickle_award(p_season_id uuid, p_preview jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE squad jsonb; member jsonb;
BEGIN
  IF NOT (p_preview->>'complete')::boolean OR NOT (p_preview->>'configured')::boolean THEN
    RAISE EXCEPTION 'PICKLE_NOT_READY: Save season prizes and resolve every game before archiving';
  END IF;
  PERFORM public.validate_league_duel_season(p_season_id);
  IF jsonb_array_length(p_preview->'squads') <> 2 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_preview->'squads') s WHERE (s->>'memberCount')::integer NOT BETWEEN 4 AND 7
  ) THEN RAISE EXCEPTION 'PICKLE_ROSTER: Two complete squads are required'; END IF;
  INSERT INTO public.pickle_awards(season_id,league_id,awarded_by,receipt)
    VALUES(p_season_id,(p_preview->>'leagueId')::uuid,auth.uid(),p_preview);
  FOR squad IN SELECT value FROM jsonb_array_elements(p_preview->'squads') LOOP
    FOR member IN SELECT value FROM jsonb_array_elements(squad->'members') LOOP
      INSERT INTO public.pickle_allocations(season_id,pool_player_id,team_id,amount)
        VALUES(p_season_id,(member->>'id')::uuid,(squad->>'id')::uuid,(squad->>'share')::numeric);
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION public.archive_season_with_pickle_points(p_season_id uuid, p_expected_preview text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE season public.seasons; preview jsonb; league uuid;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->'app_metadata'->>'role','') <> 'admin' THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id=p_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Season not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:' || league::text,0));
  SELECT * INTO season FROM public.seasons WHERE id=p_season_id FOR UPDATE;
  SELECT receipt INTO preview FROM public.pickle_awards WHERE season_id=p_season_id;
  IF FOUND THEN RETURN jsonb_build_object('season',to_jsonb(season),'receipt',preview); END IF;
  IF season.status <> 'active' THEN RAISE EXCEPTION 'PICKLE_ARCHIVED: Existing archived seasons are not eligible for new awards'; END IF;
  IF season.format='team_duel' THEN
    preview := public.calculate_pickle_preview(p_season_id);
    IF p_expected_preview IS NULL OR p_expected_preview <> preview->>'fingerprint' THEN
      RAISE EXCEPTION 'PICKLE_STALE: Results or prizes changed. Review the distribution again' USING ERRCODE='40001'; END IF;
    PERFORM public.write_pickle_award(p_season_id,preview);
  END IF;
  UPDATE public.seasons SET status='archived',ends_at=now() WHERE id=p_season_id RETURNING * INTO season;
  RETURN jsonb_build_object('season',to_jsonb(season),'receipt',preview);
END $$;

-- Narrow one-time endpoint for the requested exception, no generic backfill UI.
CREATE FUNCTION public.bootstrap_season13_pickle_points(p_season_id uuid, p_match_prize numeric, p_champion_prize numeric,
  p_apply boolean DEFAULT false, p_expected_preview text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE season public.seasons; preview jsonb; league uuid;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->'app_metadata'->>'role','') <> 'admin' THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  IF p_match_prize IS NULL OR p_champion_prize IS NULL THEN RAISE EXCEPTION 'PICKLE_AMOUNT: Both prize amounts are required'; END IF;
  SELECT s.league_id INTO league FROM public.seasons s JOIN public.leagues l ON l.id=s.league_id
    WHERE s.id=p_season_id AND l.slug='sdsap' AND s.name='Season 13' AND s.status='archived' AND s.format='team_duel';
  IF NOT FOUND OR (SELECT count(*) FROM public.seasons s JOIN public.leagues l ON l.id=s.league_id
    WHERE l.slug='sdsap' AND s.name='Season 13') <> 1 THEN RAISE EXCEPTION 'PICKLE_BOOTSTRAP: Only the unique archived SDSAP Season 13 is eligible'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:' || league::text,0));
  SELECT * INTO season FROM public.seasons WHERE id=p_season_id FOR UPDATE;
  SELECT receipt INTO preview FROM public.pickle_awards WHERE season_id=p_season_id;
  IF FOUND THEN
    IF (preview->>'matchPrize')::numeric <> p_match_prize OR (preview->>'championPrize')::numeric <> p_champion_prize THEN
      RAISE EXCEPTION 'PICKLE_FINAL: Season 13 has already been awarded with different amounts'; END IF;
    RETURN preview || jsonb_build_object('awarded',true);
  END IF;
  preview := public.calculate_pickle_preview(p_season_id,p_match_prize,p_champion_prize);
  IF NOT (preview->>'complete')::boolean THEN RAISE EXCEPTION 'PICKLE_NOT_READY: Season 13 must have complete valid results'; END IF;
  IF p_apply THEN
    IF p_expected_preview IS NULL OR p_expected_preview <> preview->>'fingerprint' THEN
      RAISE EXCEPTION 'PICKLE_STALE: Review the new Season 13 distribution' USING ERRCODE='40001'; END IF;
    UPDATE public.pickle_season_settings SET match_prize=p_match_prize,champion_prize=p_champion_prize,configured=true WHERE season_id=p_season_id;
    PERFORM public.write_pickle_award(p_season_id,preview);
  END IF;
  RETURN preview || jsonb_build_object('awarded',p_apply);
END $$;

CREATE FUNCTION public.pickle_leaderboard() RETURNS TABLE(id uuid,name text,status text,balance text,rank bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH balances AS (
    SELECT p.id,p.name,p.status,COALESCE(sum(a.amount),0) balance FROM public.player_pool p
    LEFT JOIN public.pickle_allocations a ON a.pool_player_id=p.id GROUP BY p.id
  ) SELECT id,name,status,balance::text,rank() OVER (ORDER BY balance DESC)
    FROM balances ORDER BY balance DESC,name,id;
$$;
CREATE FUNCTION public.pickle_contributions(p_player_id uuid)
RETURNS TABLE(season_id uuid,season_name text,league_name text,team_name text,amount text,awarded_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT a.season_id,s.name,l.name,t.name,a.amount::text,r.awarded_at
    FROM public.pickle_allocations a JOIN public.pickle_awards r ON r.season_id=a.season_id
    JOIN public.seasons s ON s.id=a.season_id JOIN public.leagues l ON l.id=r.league_id
    JOIN public.teams t ON t.id=a.team_id WHERE a.pool_player_id=p_player_id ORDER BY r.awarded_at DESC,a.season_id;
$$;

-- No privilege inheritance from PUBLIC, including private calculation/writer.
REVOKE ALL ON FUNCTION public.calculate_pickle_preview(uuid,numeric,numeric),public.write_pickle_award(uuid,jsonb),
  public.copy_pickle_defaults(),public.guard_pickle_source(),public.immutable_pickle_award(),
  public.pickle_settings(uuid,uuid),public.pickle_season_preview(uuid),public.pickle_leaderboard(),public.pickle_contributions(uuid),
  public.archive_season_with_pickle_points(uuid,text),public.bootstrap_season13_pickle_points(uuid,numeric,numeric,boolean,text)
  FROM PUBLIC,anon,authenticated;
-- Preview wrapper needs the invoker's calculation permission; it cannot mint.
GRANT EXECUTE ON FUNCTION public.calculate_pickle_preview(uuid,numeric,numeric),public.pickle_settings(uuid,uuid),
  public.pickle_season_preview(uuid),public.pickle_leaderboard(),public.pickle_contributions(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.archive_season_with_pickle_points(uuid,text),
  public.bootstrap_season13_pickle_points(uuid,numeric,numeric,boolean,text) TO authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pickle_awards;
