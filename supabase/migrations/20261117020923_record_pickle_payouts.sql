ALTER TABLE public.pickle_transactions
  ALTER COLUMN season_id DROP NOT NULL,
  DROP CONSTRAINT pickle_transactions_kind_check,
  DROP CONSTRAINT pickle_transactions_check,
  ADD COLUMN payout_admin_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN payout_request_id uuid,
  ADD COLUMN payout_reason text,
  ADD COLUMN payout_balance_after numeric(24,6),
  ADD CONSTRAINT pickle_transactions_source_check CHECK (
    (kind = 'payout' AND season_id IS NULL AND bet_id IS NULL AND settlement_id IS NULL
      AND reverses_id IS NULL AND amount < 0 AND payout_admin_id IS NOT NULL
      AND payout_request_id IS NOT NULL AND payout_balance_after IS NOT NULL AND payout_balance_after >= 0
      AND (payout_reason IS NULL OR char_length(payout_reason) BETWEEN 1 AND 240))
    OR (season_id IS NOT NULL AND payout_admin_id IS NULL AND payout_request_id IS NULL
      AND payout_reason IS NULL AND payout_balance_after IS NULL AND (
        (kind = 'prize' AND bet_id IS NULL AND settlement_id IS NULL AND reverses_id IS NULL)
        OR (kind = 'bet' AND bet_id IS NOT NULL AND settlement_id IS NOT NULL AND reverses_id IS NULL)
        OR (kind = 'reversal' AND bet_id IS NOT NULL AND settlement_id IS NOT NULL AND reverses_id IS NOT NULL)))
  );

CREATE UNIQUE INDEX pickle_transactions_payout_request
  ON public.pickle_transactions(payout_admin_id, payout_request_id) WHERE kind = 'payout';

CREATE FUNCTION public.pickle_payout_wallet(p_league_id uuid, p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE wallet_balance numeric; reserved_points numeric;
BEGIN
  PERFORM pickle_private.require_admin();
  IF NOT EXISTS (SELECT 1 FROM public.league_players
    WHERE league_id = p_league_id AND pool_player_id = p_player_id) THEN
    RAISE EXCEPTION 'PAYOUT_MEMBER: Player is not in this league';
  END IF;
  SELECT balance INTO wallet_balance FROM public.pickle_wallets
    WHERE league_id = p_league_id AND pool_player_id = p_player_id;
  wallet_balance := coalesce(wallet_balance, 0);
  reserved_points := pickle_private.reserved(p_league_id, p_player_id);
  RETURN jsonb_build_object('balance', wallet_balance::text, 'reserved', reserved_points::text,
    'available', greatest(wallet_balance - reserved_points, 0)::text);
END $$;

CREATE FUNCTION public.record_pickle_payout(p_league_id uuid, p_player_id uuid,
  p_amount numeric, p_reason text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  administrator uuid := auth.uid();
  reason text := nullif(btrim(p_reason, E' \n\r\t'), '');
  receipt public.pickle_transactions;
  wallet jsonb;
BEGIN
  PERFORM pickle_private.require_admin();
  IF p_amount IS NULL OR NOT (p_amount BETWEEN 0.000001 AND 999999999999999999.999999)
      OR p_amount <> round(p_amount, 6) THEN
    RAISE EXCEPTION 'PAYOUT_AMOUNT: Enter a positive amount with up to six decimal places';
  END IF;
  IF char_length(reason) > 240 THEN RAISE EXCEPTION 'PAYOUT_REASON: Reason is too long'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'PAYOUT_REQUEST: A request identifier is required'; END IF;
  -- Serialize retries before locking the league and wallet, including requests reused across leagues.
  PERFORM pg_advisory_xact_lock(hashtextextended('pickle_payout:' || administrator::text || ':' || p_request_id::text, 0));
  SELECT * INTO receipt FROM public.pickle_transactions
    WHERE kind = 'payout' AND payout_admin_id = administrator AND payout_request_id = p_request_id;

  IF FOUND THEN
    IF (receipt.league_id, receipt.pool_player_id, receipt.amount, receipt.payout_reason)
       IS DISTINCT FROM (p_league_id, p_player_id, -p_amount, reason) THEN
      RAISE EXCEPTION 'PAYOUT_REQUEST: Request was used for a different payout';
    END IF;
  ELSE
    IF p_league_id IS NULL THEN RAISE EXCEPTION 'PAYOUT_MEMBER: Player is not in this league'; END IF;
    -- Use the same lock order as bet creation, acceptance and settlement.
    PERFORM pg_advisory_xact_lock(hashtextextended('league_replace_ratings:' || p_league_id::text, 0));
    PERFORM 1 FROM public.league_players
      WHERE league_id = p_league_id AND pool_player_id = p_player_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYOUT_MEMBER: Player is not in this league'; END IF;
    PERFORM pickle_private.lock_wallets(p_league_id, ARRAY[p_player_id]);
    wallet := public.pickle_payout_wallet(p_league_id, p_player_id);
    IF (wallet->>'available')::numeric < p_amount THEN
      RAISE EXCEPTION 'PAYOUT_FUNDS: Payout exceeds available points';
    END IF;

    INSERT INTO public.pickle_transactions(league_id, pool_player_id, kind, amount,
      payout_admin_id, payout_request_id, payout_reason, payout_balance_after)
    VALUES(p_league_id, p_player_id, 'payout', -p_amount,
      administrator, p_request_id, reason, (wallet->>'balance')::numeric - p_amount)
    RETURNING * INTO receipt;
  END IF;

  RETURN jsonb_build_object('id', receipt.id, 'amount', (-receipt.amount)::text,
    'balanceAfter', receipt.payout_balance_after::text, 'createdAt', receipt.created_at);
END $$;

CREATE OR REPLACE FUNCTION public.pickle_wallet_history(p_league_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p uuid := pickle_private.player_id();
BEGIN
  IF p IS NULL OR NOT EXISTS (SELECT 1 FROM public.league_players
    WHERE league_id = p_league_id AND pool_player_id = p) THEN
    RAISE EXCEPTION 'BET_LINK: Linked league membership required' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', t.id, 'amount', t.amount::text, 'kind', t.kind, 'seasonName', s.name, 'betId', t.bet_id,
    'matchId', r.match_id, 'revision', r.revision, 'reason', coalesce(t.payout_reason, r.reason),
    'createdAt', t.created_at) ORDER BY t.created_at DESC, t.id)
    FROM public.pickle_transactions t LEFT JOIN public.seasons s ON s.id = t.season_id
    LEFT JOIN public.pickle_bet_settlements r ON r.id = t.settlement_id
    WHERE t.league_id = p_league_id AND t.pool_player_id = p), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.pickle_payout_wallet(uuid, uuid),
  public.record_pickle_payout(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pickle_payout_wallet(uuid, uuid),
  public.record_pickle_payout(uuid, uuid, numeric, text, uuid) TO authenticated;
