-- A cancellation is a final, unplayed fixture: never a forfeit or rating event.
ALTER TABLE public.matches DROP CONSTRAINT matches_status_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled','completed','forfeit','cancelled'));
ALTER TABLE public.matches DROP CONSTRAINT matches_result_state_is_consistent;
ALTER TABLE public.matches ADD CONSTRAINT matches_result_state_is_consistent CHECK (
  (status IN ('scheduled','cancelled') AND winner_team_id IS NULL AND home_score IS NULL AND away_score IS NULL)
  OR (status='forfeit' AND winner_team_id IS NOT NULL AND home_score IS NULL AND away_score IS NULL)
  OR (status='completed' AND winner_team_id IS NOT NULL AND (
    (home_score IS NULL AND away_score IS NULL) OR
    (home_score IS NOT NULL AND away_score IS NOT NULL AND home_score<>away_score AND
      ((winner_team_id=home_team_id AND home_score>away_score) OR (winner_team_id=away_team_id AND away_score>home_score)))
  ))
);
ALTER TABLE public.matches ADD CONSTRAINT matches_cancelled_is_unplayed
  CHECK (status<>'cancelled' OR (result_recorded_at IS NULL AND live_status='available' AND live_court_number IS NULL));

-- Enforce the transition for direct SQL/API writes too. All effects roll back together.
CREATE FUNCTION public.guard_match_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='cancelled' AND
    (NEW.status,NEW.winner_team_id,NEW.home_score,NEW.away_score,NEW.result_recorded_at)
      IS DISTINCT FROM (OLD.status,OLD.winner_team_id,OLD.home_score,OLD.away_score,OLD.result_recorded_at) THEN
    RAISE EXCEPTION 'MATCH_CANCELLED: A cancelled match cannot receive a result';
  END IF;
  IF NEW.status='cancelled' THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'MATCH_CANCEL: Only an existing unplayed match can be cancelled'; END IF;
    IF OLD.status NOT IN ('scheduled','cancelled') OR OLD.winner_team_id IS NOT NULL
      OR OLD.home_score IS NOT NULL OR OLD.away_score IS NOT NULL OR OLD.result_recorded_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.rating_history WHERE match_id=OLD.id) THEN
      RAISE EXCEPTION 'MATCH_CANCEL: Only an unplayed match can be cancelled';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.seasons s JOIN public.leagues l ON l.id=s.league_id
      WHERE s.id=NEW.season_id AND s.status='active' AND l.status='active') THEN
      RAISE EXCEPTION 'MATCH_CANCEL: League and season must be active';
    END IF;
    NEW.live_status:='available'; NEW.live_court_number:=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ac_guard_match_cancellation BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_match_cancellation();

-- Private privilege boundary is needed to release protected bet reservations.
CREATE FUNCTION pickle_private.cancel_unplayed_match(p_match_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.matches;
BEGIN
  PERFORM pickle_private.require_admin();
  m:=pickle_private.lock_match(p_match_id);
  IF m.status='cancelled' THEN RETURN; END IF;
  IF m.status<>'scheduled' THEN RAISE EXCEPTION 'MATCH_CANCEL: Only an unplayed match can be cancelled'; END IF;
  UPDATE public.matches SET status='cancelled',winner_team_id=NULL,home_score=NULL,away_score=NULL,
    result_recorded_at=NULL,live_status='available',live_court_number=NULL WHERE id=m.id;
  -- Deliberately leave league ratings, rating history, rating revision and wallets untouched.
END $$;
REVOKE ALL ON FUNCTION pickle_private.cancel_unplayed_match(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION pickle_private.cancel_unplayed_match(uuid) TO authenticated;
CREATE FUNCTION public.cancel_unplayed_match(p_match_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT pickle_private.cancel_unplayed_match(p_match_id) $$;
REVOKE ALL ON FUNCTION public.cancel_unplayed_match(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_unplayed_match(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION pickle_private.guard_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE league uuid; changed boolean; BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF OLD.betting_closed_at IS NOT NULL AND NEW.betting_closed_at IS DISTINCT FROM OLD.betting_closed_at THEN
    RAISE EXCEPTION 'BET_CLOSED: Betting cannot reopen'; END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id=OLD.season_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:'||league::text,0));
  PERFORM 1 FROM public.seasons WHERE id=OLD.season_id FOR UPDATE;
  changed:=NEW.season_id IS DISTINCT FROM OLD.season_id OR NEW.home_team_id IS DISTINCT FROM OLD.home_team_id OR NEW.away_team_id IS DISTINCT FROM OLD.away_team_id
    OR pickle_private.side_ids(NEW,true) IS DISTINCT FROM pickle_private.side_ids(OLD,true)
    OR pickle_private.side_ids(NEW,false) IS DISTINCT FROM pickle_private.side_ids(OLD,false);
  IF (SELECT status FROM public.seasons WHERE id=OLD.season_id)='archived' AND EXISTS(SELECT 1 FROM public.pickle_bets WHERE match_id=OLD.id)
    AND (changed OR pickle_private.result_fingerprint(NEW)<>pickle_private.result_fingerprint(OLD)) THEN RAISE EXCEPTION 'BET_FINAL: Archived bet results are final'; END IF;
  IF EXISTS(SELECT 1 FROM public.pickle_bet_settlements WHERE match_id=OLD.id) AND (
    EXISTS(SELECT 1 FROM public.pickle_bets WHERE match_id=OLD.id AND state IN('accepted','review','settled','refunded'))
    OR EXISTS(SELECT 1 FROM public.pickle_transactions t JOIN public.pickle_bets b ON b.id=t.bet_id
      WHERE b.match_id=OLD.id GROUP BY t.bet_id,t.pool_player_id HAVING sum(t.amount)<>0)
  ) AND
    (changed OR pickle_private.result_fingerprint(NEW)<>pickle_private.result_fingerprint(OLD)) AND NOT EXISTS(
      SELECT 1 FROM pickle_private.correction_context WHERE transaction_id=txid_current() AND match_id=OLD.id) THEN
    RAISE EXCEPTION 'BET_CORRECTION: Use the reviewed bet correction flow'; END IF;
  IF NEW.status='cancelled' THEN
    UPDATE public.pickle_bets SET state='void',close_reason='match_cancelled',updated_at=now()
      WHERE match_id=OLD.id AND state IN('open','accepted','review');
  END IF;
  IF changed THEN
    IF EXISTS(SELECT 1 FROM public.pickle_bets WHERE match_id=OLD.id AND state IN('settled','refunded')) THEN RAISE EXCEPTION 'BET_LINEUP: Settled bet lineups cannot change'; END IF;
    UPDATE public.pickle_bets SET state='void',close_reason='lineup',updated_at=now() WHERE match_id=OLD.id AND state IN('open','accepted','review');
  END IF;
  IF NEW.status<>'scheduled' OR NEW.live_status='playing' OR OLD.status<>'scheduled' OR OLD.live_status='playing' THEN
    NEW.betting_closed_at:=coalesce(OLD.betting_closed_at,now());
    UPDATE public.pickle_bets SET state='cancelled',close_reason='match_closed',updated_at=now() WHERE match_id=OLD.id AND state='open';
  END IF;
  UPDATE public.pickle_bets SET state=CASE WHEN NEW.status='scheduled' THEN 'accepted' ELSE 'review' END,updated_at=now()
    WHERE match_id=OLD.id AND state IN('accepted','review');
  RETURN NEW;
END $$;

-- Cancelled fixtures finish the schedule without earning a win or match prize.
-- If every fixture is cancelled, no champion bonus is awarded.
CREATE OR REPLACE FUNCTION public.calculate_pickle_preview(p_season_id uuid, p_match_prize numeric DEFAULT NULL, p_champion_prize numeric DEFAULT NULL)
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
    COALESCE(bool_and(status IN ('scheduled','cancelled') OR (winner_team_id IS NOT NULL AND winner_team_id IN (home_team_id,away_team_id))),true),
    COALESCE(jsonb_agg(jsonb_build_object('id',id,'status',status,'winner',winner_team_id,'home',home_team_id,
      'away',away_team_id,'homeScore',home_score,'awayScore',away_score,'homePlayers',home_pool_player_ids,
      'awayPlayers',away_pool_player_ids,'recordedAt',result_recorded_at) ORDER BY id),'[]')
    INTO total,remaining,valid,fixtures FROM public.matches WHERE season_id = p_season_id;
  complete := total > 0 AND remaining = 0 AND valid;
  SELECT max(wins) INTO max_wins FROM (
    SELECT (SELECT count(*) FROM public.matches m WHERE m.season_id = p_season_id AND m.status IN ('completed','forfeit') AND m.winner_team_id = t.id) AS wins
    FROM public.teams t WHERE t.season_id = p_season_id) scores;
  SELECT count(*) INTO champions FROM public.teams t WHERE t.season_id = p_season_id AND
    (SELECT count(*) FROM public.matches m WHERE m.season_id = p_season_id AND m.status IN ('completed','forfeit') AND m.winner_team_id = t.id) = max_wins;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'wins',t.wins,
    'matchTotal',(t.wins * match_prize)::text,
    'championTotal',CASE WHEN complete THEN (CASE WHEN t.wins=max_wins AND max_wins>0 THEN champion_prize / NULLIF(champions,0) ELSE 0 END)::text ELSE NULL END,
    'total',(t.wins * match_prize + CASE WHEN complete AND t.wins=max_wins AND max_wins>0 THEN champion_prize / NULLIF(champions,0) ELSE 0 END)::text,
    'memberCount',jsonb_array_length(t.members),'members',t.members,
    'share',round((t.wins * match_prize + CASE WHEN complete AND t.wins=max_wins AND max_wins>0 THEN champion_prize / NULLIF(champions,0) ELSE 0 END) / NULLIF(jsonb_array_length(t.members),0),6)::text
  ) ORDER BY t.id),'[]') INTO squads FROM (
    SELECT team.id,team.name,
      (SELECT count(*) FROM public.matches m WHERE m.season_id=p_season_id AND m.status IN ('completed','forfeit') AND m.winner_team_id=team.id) wins,
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

