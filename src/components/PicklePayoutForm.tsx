import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { useConfirm } from '../lib/confirmation'
import { addPoints } from '../lib/betsApi'
import { formatPicklePoints, parsePicklePayoutAmount, type PickleRankingRow } from '../lib/picklePoints'
import { fetchPicklePayoutWallet, recordPicklePayout, type PicklePayoutReceipt } from '../lib/picklePointsApi'

type PayoutRequest = { id: string; amount: string; reason: string | null }
const points = (value: string) => formatPicklePoints(value, 6)
const inputClass = 'mt-1 block min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-gray-900'
const buttonClass = 'min-h-11 rounded-lg bg-green-700 px-4 font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50'

function readPendingPayout(key: string): PayoutRequest | null {
  try {
    const stored = sessionStorage.getItem(key)
    return stored ? JSON.parse(stored) as PayoutRequest : null
  } catch {
    return null
  }
}

export function PicklePayoutForm({ player, adminId }: { player: PickleRankingRow; adminId: string }) {
  const { t } = useTranslation()
  const { league } = useLeague()
  const client = useQueryClient()
  const confirm = useConfirm()
  const wallet = useQuery({
    queryKey: ['bets', 'payout-wallet', league.id, adminId, player.id],
    queryFn: () => fetchPicklePayoutWallet(league.id, player.id),
    refetchOnWindowFocus: 'always',
  })
  const submitting = useRef(false)
  const storageKey = `pickle-payout:${adminId}:${league.id}:${player.id}`
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(() => readPendingPayout(storageKey))
  const [amount, setAmount] = useState(pending?.amount ?? '')
  const [reason, setReason] = useState(pending?.reason ?? '')
  const [receipt, setReceipt] = useState<PicklePayoutReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const payout = parsePicklePayoutAmount(amount)
  const available = wallet.data?.available
  const exceedsAvailable = payout && available !== undefined && addPoints(available, '-' + payout).startsWith('-')
  const canReview = payout && wallet.data && !wallet.isError && !wallet.isFetching && !exceedsAvailable

  function savePending(request: PayoutRequest | null) {
    setPending(request)
    try {
      if (request) sessionStorage.setItem(storageKey, JSON.stringify(request))
      else sessionStorage.removeItem(storageKey)
    } catch {
      // The open form can still retry in browsers that block session storage.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || (!pending && (!canReview || !wallet.data))) return
    submitting.current = true
    setBusy(true)
    setError(null)
    setReceipt(null)
    try {
      let request = pending
      if (!request && canReview && payout && wallet.data) {
        const note = reason.trim() || null
        const approved = await confirm(t('picklePayout.review', {
          player: player.name, league: league.name, amount: points(payout),
          before: points(wallet.data.balance), reserved: points(wallet.data.reserved),
          after: points(addPoints(wallet.data.balance, '-' + payout)),
        }), {
          title: t('picklePayout.reviewTitle'), confirmLabel: t('picklePayout.confirm'), tone: 'danger',
          details: note ? <p className="break-words text-sm text-gray-600">{note}</p> : undefined,
        })
        if (!approved) return
        request = { id: crypto.randomUUID(), amount: payout, reason: note }
        savePending(request)
      }
      if (!request) return
      const saved = await recordPicklePayout(league.id, player.id, request.amount, request.reason, request.id)
      setReceipt(saved)
      savePending(null)
      setAmount('')
      setReason('')
      void client.invalidateQueries({ queryKey: ['pickle-points', 'league-leaderboard', league.id] })
      void client.invalidateQueries({ queryKey: ['bets'] })
    } catch (failure) {
      const message = failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : ''
      const code = /^(PAYOUT_(?:FUNDS|MEMBER|REQUEST|AMOUNT|REASON)|BET_ADMIN):/.exec(message)?.[1]
      if (code) {
        savePending(null)
        setError(t(`picklePayout.errors.${code}`))
        void wallet.refetch()
      } else setError(t('picklePayout.retryHelp'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <form aria-label={t('picklePayout.title')} onSubmit={(event) => void submit(event)} className="mt-3 space-y-3 border-t border-green-100 pt-3">
    {wallet.isLoading ? <p role="status" className="text-sm">{t('common.loading')}</p> : null}
    {wallet.isError ? <p role="alert" className="text-sm text-red-700">{t('picklePayout.walletError')}{' '}
      <button type="button" onClick={() => void wallet.refetch()} className="min-h-11 font-bold underline">{t('me.retry')}</button>
    </p> : null}
    {wallet.data ? <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
      {(['balance', 'reserved', 'available'] as const).map((key) => <div key={key}>
        <dt className="text-gray-600">{t(`bets.${key}`)}</dt>
        <dd className="break-words font-semibold text-green-950">{points(wallet.data[key])}</dd>
      </div>)}
    </dl> : null}
    <fieldset disabled={busy || !!pending} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold text-green-950">{t('picklePayout.amount')}
        <input className={inputClass} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" maxLength={25} />
      </label>
      <label className="text-sm font-semibold text-green-950">{t('picklePayout.reason')}
        <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={240} />
      </label>
    </fieldset>
    {!pending && amount && (!payout || exceedsAvailable) ? <p className="text-sm text-red-700">
      {t(payout ? 'picklePayout.errors.PAYOUT_FUNDS' : 'picklePayout.errors.PAYOUT_AMOUNT')}
    </p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {pending && !busy && !error ? <p className="text-sm text-gray-600">{t('picklePayout.retryHelp')}</p> : null}
    {receipt ? <p role="status" className="text-sm font-semibold text-green-800">{t('picklePayout.recorded', {
      amount: points(receipt.amount), balance: points(receipt.balanceAfter), receipt: receipt.id,
    })}</p> : null}
    <button type="submit" disabled={busy || (!pending && !canReview)} className={buttonClass}>
      {t(busy ? 'picklePayout.working' : pending ? 'picklePayout.retry' : 'picklePayout.reviewTitle')}
    </button>
  </form>
}
