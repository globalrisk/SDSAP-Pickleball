BEGIN;
DO $$
DECLARE
  league uuid := gen_random_uuid();
  season uuid := gen_random_uuid();
  admin uuid := gen_random_uuid();
  player_user uuid := gen_random_uuid();
  request uuid := gen_random_uuid();
  ids uuid[];
  seeds jsonb;
  home uuid;
  away uuid;
  match_id uuid;
  offer uuid;
  receipt jsonb;
  wallet jsonb;
  history jsonb;
  invalid_amount numeric;
BEGIN
  INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
    (admin,'payout-admin@test.local','{"role":"admin"}'),
    (player_user,'payout-player@test.local','{}');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',admin,'app_metadata',jsonb_build_object('role','admin'))::text, true);
  SELECT array_agg(id ORDER BY n), jsonb_agg(jsonb_build_object('id',id,'name','Payout player '||n,'is_new',true,'initial_rating',1500))
  INTO ids,seeds FROM (SELECT n,gen_random_uuid() id FROM generate_series(1,5) n) q;
  PERFORM public.create_league_atomic(league,'payout-test','Payout tests',season,'Payout season',seeds,'[]','[]');
  PERFORM public.save_season_roster_atomic(season,ids);
  INSERT INTO public.teams(season_id,name,color) VALUES(season,'Home','#15803d') RETURNING id INTO home;
  INSERT INTO public.teams(season_id,name,color) VALUES(season,'Away','#1d4ed8') RETURNING id INTO away;
  FOR n IN 1..4 LOOP
    INSERT INTO public.players(name,team_id,pool_player_id,season_id)
      VALUES('Payout player '||n,CASE WHEN n<3 THEN home ELSE away END,ids[n],season);
  END LOOP;
  INSERT INTO public.matches(season_id,home_team_id,away_team_id,round_number,home_pool_player_ids,away_pool_player_ids)
    VALUES(season,home,away,1,ids[1:2],ids[3:4]) RETURNING id INTO match_id;
  PERFORM public.link_player_account(ids[5],'payout-player@test.local');
  INSERT INTO public.pickle_wallets(league_id,pool_player_id) VALUES(league,ids[5]);
  INSERT INTO public.pickle_transactions(league_id,pool_player_id,amount,kind,season_id)
    VALUES(league,ids[5],5000.125001,'prize',season);

  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.record_pickle_payout(league,ids[5],1000,NULL,request);
    RAISE EXCEPTION 'Anonymous payout allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',player_user,'user_metadata',jsonb_build_object('role','admin'))::text, true);
  BEGIN
    PERFORM public.record_pickle_payout(league,ids[5],1000,NULL,request);
    RAISE EXCEPTION 'Non-admin payout allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.pickle_payout_wallet(league,ids[5]);
    RAISE EXCEPTION 'Non-admin wallet preview allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  offer := public.create_pickle_bet(match_id,home,2000,1000,gen_random_uuid());

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',admin,'app_metadata',jsonb_build_object('role','admin'))::text, true);
  wallet := public.pickle_payout_wallet(league,ids[5]);
  IF (wallet->>'balance')::numeric <> 5000.125001 OR (wallet->>'reserved')::numeric <> 2000
    OR (wallet->>'available')::numeric <> 3000.125001 THEN RAISE EXCEPTION 'Incorrect wallet preview'; END IF;
  BEGIN
    PERFORM public.record_pickle_payout('11111111-1111-4111-8111-111111111111',ids[5],100,NULL,request);
    RAISE EXCEPTION 'Payout crossed leagues';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PAYOUT_MEMBER:%' THEN RAISE; END IF;
  END;
  FOR invalid_amount IN SELECT unnest(ARRAY[0,-1,1.0000001,'NaN'::numeric,'Infinity'::numeric,NULL]) LOOP
    BEGIN
      PERFORM public.record_pickle_payout(league,ids[5],invalid_amount,NULL,request);
      RAISE EXCEPTION 'Invalid payout amount accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PAYOUT_AMOUNT:%' THEN RAISE; END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM public.record_pickle_payout(league,ids[5],3000.125002,NULL,request);
    RAISE EXCEPTION 'Payout spent reserved points';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PAYOUT_FUNDS:%' THEN RAISE; END IF;
  END;

  receipt := public.record_pickle_payout(league,ids[5],3000.125001,E' \t',request);
  IF (receipt->>'balanceAfter')::numeric <> 2000 OR
    public.record_pickle_payout(league,ids[5],3000.125001,NULL,request) IS DISTINCT FROM receipt THEN
    RAISE EXCEPTION 'Retry did not return the original payout';
  END IF;
  BEGIN
    PERFORM public.record_pickle_payout(league,ids[5],100,NULL,request);
    RAISE EXCEPTION 'Changed request was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'PAYOUT_REQUEST:%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.pickle_transactions WHERE league_id=league AND kind='payout') <> 1 OR
    NOT EXISTS (SELECT 1 FROM public.pickle_transactions WHERE id=(receipt->>'id')::uuid AND payout_admin_id=admin
      AND payout_request_id=request AND payout_reason IS NULL AND season_id IS NULL) THEN
    RAISE EXCEPTION 'Payout audit or deduplication failed';
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',player_user)::text, true);
  BEGIN
    PERFORM public.create_pickle_bet(match_id,away,1000,1000,gen_random_uuid());
    RAISE EXCEPTION 'Offer spent paid-out points';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'BET_FUNDS:%' THEN RAISE; END IF;
  END;
  PERFORM public.cancel_pickle_bet(offer);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',admin,'app_metadata',jsonb_build_object('role','admin'))::text, true);
  PERFORM public.record_pickle_payout(league,ids[5],2000,'  Club payout  ',gen_random_uuid());
  IF (SELECT balance::numeric FROM public.pickle_leaderboard(league) WHERE id=ids[5]) <> 0 THEN
    RAISE EXCEPTION 'Leaderboard missed the deduction';
  END IF;
  IF public.record_pickle_payout(league,ids[5],3000.125001,NULL,request) IS DISTINCT FROM receipt THEN
    RAISE EXCEPTION 'Retry returned a later balance';
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',player_user)::text, true);
  wallet := public.pickle_wallet(league);
  history := public.pickle_wallet_history(league);
  IF (wallet->>'balance')::numeric <> 0 OR (wallet->>'reserved')::numeric <> 0 OR
    jsonb_array_length(history) <> 3 OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(history) t WHERE t->>'kind'='payout' AND t->>'seasonName' IS NULL
        AND (t->>'amount')::numeric = -2000 AND t->>'reason' = 'Club payout'
    ) OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(history) t WHERE t->>'kind'='prize' AND t->>'seasonName'='Payout season'
    ) THEN
    RAISE EXCEPTION 'Player wallet or transaction history incorrect';
  END IF;
END $$;
ROLLBACK;
