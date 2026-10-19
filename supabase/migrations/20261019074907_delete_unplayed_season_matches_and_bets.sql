-- A reviewed, atomic reset for an active season's unplayed schedule and bets.
-- Held stakes are reservations, so deleting unsettled contracts releases them
-- without changing balances or immutable financial transactions.
CREATE TABLE pickle_private.season_match_deletions (
  request_id uuid PRIMARY KEY,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE RESTRICT,
  removed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL,
  matches jsonb NOT NULL,
  bets jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_match_deletions_season_idx ON pickle_private.season_match_deletions(season_id);
CREATE INDEX season_match_deletions_admin_idx ON pickle_private.season_match_deletions(removed_by);
ALTER TABLE pickle_private.season_match_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pickle_private.season_match_deletions FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_season_match_deletions BEFORE UPDATE OR DELETE ON pickle_private.season_match_deletions
FOR EACH ROW EXECUTE FUNCTION pickle_private.immutable();

CREATE FUNCTION public.season_match_deletion_preview(p_season_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.seasons; fixture_rows jsonb; bet_rows jsonb; deletable boolean;
BEGIN
  PERFORM pickle_private.require_admin();
  SELECT * INTO s FROM public.seasons WHERE id=p_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SEASON_DELETE_BLOCKED: Season not found'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) INTO fixture_rows
    FROM public.matches m WHERE m.season_id=p_season_id;
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]'::jsonb) INTO bet_rows
    FROM public.pickle_bets b WHERE b.season_id=p_season_id;
  deletable:=s.status='active' AND (SELECT status FROM public.leagues WHERE id=s.league_id)='active'
    AND jsonb_array_length(fixture_rows)>0
    AND NOT EXISTS(SELECT 1 FROM public.pickle_awards WHERE season_id=p_season_id)
    AND NOT EXISTS(SELECT 1 FROM public.matches WHERE season_id=p_season_id AND
      (status IS DISTINCT FROM 'scheduled' OR home_score IS NOT NULL OR away_score IS NOT NULL
        OR winner_team_id IS NOT NULL OR result_recorded_at IS NOT NULL OR live_status='playing'))
    AND NOT EXISTS(SELECT 1 FROM public.rating_history h JOIN public.matches m ON m.id=h.match_id WHERE m.season_id=p_season_id)
    AND NOT EXISTS(SELECT 1 FROM public.pickle_bet_settlements r JOIN public.matches m ON m.id=r.match_id WHERE m.season_id=p_season_id)
    AND NOT EXISTS(SELECT 1 FROM public.pickle_transactions WHERE season_id=p_season_id AND kind IN('bet','reversal'))
    AND NOT EXISTS(SELECT 1 FROM public.pickle_bets WHERE season_id=p_season_id AND state IN('review','settled','refunded'));
  RETURN jsonb_build_object('seasonId',s.id,'matchCount',jsonb_array_length(fixture_rows),'betCount',jsonb_array_length(bet_rows),
    'openCount',(SELECT count(*) FROM public.pickle_bets WHERE season_id=s.id AND state='open'),
    'acceptedCount',(SELECT count(*) FROM public.pickle_bets WHERE season_id=s.id AND state='accepted'),
    'releasedPoints',(SELECT coalesce(sum(creator_stake+CASE WHEN acceptor_id IS NOT NULL THEN acceptor_stake ELSE 0 END),0)::text
      FROM public.pickle_bets WHERE season_id=s.id AND state IN('open','accepted','review')),
    'canDelete',deletable,'fingerprint',md5(jsonb_build_array(s.status,(SELECT status FROM public.leagues WHERE id=s.league_id),fixture_rows,bet_rows)::text));
END $$;

CREATE FUNCTION public.delete_unplayed_season_matches_and_bets(p_season_id uuid,p_fingerprint text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE league uuid; preview jsonb; previous pickle_private.season_match_deletions; result jsonb; deleted integer;
BEGIN
  PERFORM pickle_private.require_admin();
  IF p_request_id IS NULL OR p_fingerprint IS NULL OR p_fingerprint='' THEN
    RAISE EXCEPTION 'SEASON_DELETE_STALE: Review the deletion first' USING ERRCODE='40001';
  END IF;
  -- Serialize retries before taking the shared league/result/wallet lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('season_match_deletion:'||p_request_id::text,0));
  SELECT * INTO previous FROM pickle_private.season_match_deletions WHERE request_id=p_request_id;
  IF FOUND THEN
    IF previous.season_id IS DISTINCT FROM p_season_id OR previous.fingerprint<>p_fingerprint OR previous.removed_by<>auth.uid() THEN
      RAISE EXCEPTION 'SEASON_DELETE_REQUEST: Request identifier reused with different terms';
    END IF;
    RETURN previous.result;
  END IF;
  SELECT league_id INTO league FROM public.seasons WHERE id=p_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SEASON_DELETE_BLOCKED: Season not found'; END IF;
  -- Same league lock as bet creation, acceptance, cancellation and settlement.
  PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:'||league::text,0));
  -- Older live/setup operations may hold season locks before the league lock.
  -- Refuse a busy schedule instead of waiting in the opposite lock order.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sdsap_live_queue:'||p_season_id::text,0)) THEN
    RAISE EXCEPTION 'SEASON_DELETE_STALE: Match operations are in progress. Review again' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.seasons WHERE id=p_season_id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.matches WHERE season_id=p_season_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.pickle_bets WHERE season_id=p_season_id ORDER BY id FOR UPDATE NOWAIT;
  preview:=public.season_match_deletion_preview(p_season_id);
  IF NOT (preview->>'canDelete')::boolean THEN
    RAISE EXCEPTION 'SEASON_DELETE_BLOCKED: Only active unplayed schedules without financial settlements can be deleted';
  END IF;
  IF preview->>'fingerprint'<>p_fingerprint THEN
    RAISE EXCEPTION 'SEASON_DELETE_STALE: Matches or bets changed. Review the deletion again' USING ERRCODE='40001';
  END IF;
  result:=preview-'fingerprint'-'canDelete';
  INSERT INTO pickle_private.season_match_deletions(request_id,season_id,removed_by,fingerprint,matches,bets,result)
  SELECT p_request_id,p_season_id,auth.uid(),p_fingerprint,
    (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) FROM public.matches m WHERE m.season_id=p_season_id),
    (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]'::jsonb) FROM public.pickle_bets b WHERE b.season_id=p_season_id),result;
  -- No money/points move: reserved() derives held points from these contracts.
  DELETE FROM public.pickle_bets WHERE season_id=p_season_id;
  GET DIAGNOSTICS deleted=ROW_COUNT;
  IF deleted<>(preview->>'betCount')::integer THEN RAISE EXCEPTION 'SEASON_DELETE_STALE: Bet list changed'; END IF;
  DELETE FROM public.matches WHERE season_id=p_season_id;
  GET DIAGNOSTICS deleted=ROW_COUNT;
  IF deleted<>(preview->>'matchCount')::integer THEN RAISE EXCEPTION 'SEASON_DELETE_STALE: Match list changed'; END IF;
  IF (SELECT format FROM public.seasons WHERE id=p_season_id)='team_duel' THEN
    UPDATE public.seasons SET duel_draft_rating_revision=NULL,duel_draft_rating_fingerprint=NULL WHERE id=p_season_id;
    PERFORM public.validate_league_duel_season(p_season_id);
  END IF;
  RETURN result;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'SEASON_DELETE_STALE: Match operations are in progress. Review again' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.season_match_deletion_preview(uuid),public.delete_unplayed_season_matches_and_bets(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.season_match_deletion_preview(uuid),public.delete_unplayed_season_matches_and_bets(uuid,text,uuid) TO authenticated;
