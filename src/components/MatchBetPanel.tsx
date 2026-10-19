import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { acceptBet, betErrorMessage, createBet, isBetStake, type PickleBet, type PickleWallet } from '../lib/betsApi'
import { formatPicklePoints } from '../lib/picklePoints'
import { resolveMatchLineups } from '../lib/playerMatches'
import { canAcceptMatchOffer, hasBetFunds, matchBettingSides, matchBettingStatus } from '../lib/matchBetting'
import { calculateMatchProbability } from '../lib/matchProbability'
import { useConfirm } from '../lib/confirmation'
import type { MatchWithTeams, PoolPlayer } from '../types'
import { ErrorState } from './Layout'
import { BetOfferCard } from './BetOfferCard'
import { BetAcceptanceDetails, BetPairSummary, BetTerms } from './BetSlip'

const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base'
const buttonClass = 'min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50'

export function MatchBetPanel({ match, playerId, wallet, pool, offers, view, onViewChange, eligible }: {
  match: MatchWithTeams; playerId?: string; wallet?: PickleWallet; pool: PoolPlayer[]; offers: PickleBet[]
  view: 'offer' | 'offers'; onViewChange: (view: 'offer' | 'offers') => void; eligible: boolean
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const client = useQueryClient()
  const [selectedSideId, setSideId] = useState('')
  const allowedSides = matchBettingSides(match, playerId)
  const sideId = allowedSides.length === 1 ? allowedSides[0]! : selectedSideId
  const [stake, setStake] = useState('1000')
  const [differentStake, setDifferentStake] = useState(false)
  const [opponentStake, setOpponentStake] = useState('1000')
  const [created, setCreated] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const acceptIds = useRef(new Map<string, string>())
  const { homeIds, awayIds } = resolveMatchLineups(match)
  const names = (ids: string[]) => ids.map(id => pool.find(p => p.id === id)?.name
    ?? [...(match.home_team.players ?? []), ...(match.away_team.players ?? [])].find(p => p.pool_player_id === id)?.name
    ?? t('personal.unknownPlayer'))
  const homeNames = names(homeIds)
  const awayNames = names(awayIds)
  const otherStake = differentStake ? opponentStake : stake
  const status = matchBettingStatus(match)
  const probability = calculateMatchProbability(match.home_team, match.away_team)
  const valid = isBetStake(stake) && isBetStake(otherStake)
  const funded = hasBetFunds(wallet?.available, stake)
  const refresh = () => Promise.all(['bets', 'pickle-points', 'matches'].map(key => client.invalidateQueries({ queryKey: [key] })))
  const offer = useMutation({
    mutationFn: async () => {
      if (!eligible || status !== 'open' || !allowedSides.includes(sideId) || !valid) throw new Error(t('bets.invalidStake'))
      if (!funded) throw new Error(t('matchBets.insufficient'))
      await createBet(match.id, sideId, stake, otherStake, requestId.current)
    },
    onSuccess: async () => {
      requestId.current = crypto.randomUUID(); setCreated(true); setSideId('')
      await refresh()
    },
  })
  const acceptance = useMutation({
    mutationFn: async (bet: PickleBet) => {
      if (!eligible || !canAcceptMatchOffer(match, bet.creatorSide, playerId) || bet.creatorId === playerId || bet.state !== 'open' || bet.matchId !== match.id) throw new Error(t('matchBets.closed'))
      if (!hasBetFunds(wallet?.available, bet.acceptorStake)) throw new Error(t('matchBets.insufficient'))
      let id = acceptIds.current.get(bet.id)
      if (!id) { id = crypto.randomUUID(); acceptIds.current.set(bet.id, id) }
      await acceptBet(bet.id, id)
    },
    onSuccess: refresh,
  })
  const pending = offer.isPending || acceptance.isPending
  async function reviewCreation() {
    if (pending || !eligible || status !== 'open' || !allowedSides.includes(sideId) || !valid || !funded) return
    const terms = t('bets.offerConfirm', { stake: formatPicklePoints(stake), other: formatPicklePoints(otherStake) })
    if (await confirm(terms, { title: t('betSlip.reviewCreate'), confirmLabel: t('bets.create'), details: <>
      <BetPairSummary names={sideId === match.home_team_id ? homeNames : awayNames} label={t('betSlip.youBack')} highlighted />
      <BetTerms stake={stake} profit={otherStake} />
    </> })) offer.mutate()
  }
  async function reviewAcceptance(bet: PickleBet) {
    if (pending || !eligible || bet.creatorId === playerId || bet.state !== 'open' || bet.matchId !== match.id || !canAcceptMatchOffer(match, bet.creatorSide, playerId) || !hasBetFunds(wallet?.available, bet.acceptorStake)) return
    if (await confirm(t('betSlip.reviewTerms'), { title: t('betSlip.reviewTitle'), confirmLabel: t('betSlip.acceptOffer'), details: <BetAcceptanceDetails bet={bet} /> })) acceptance.mutate(bet)
  }
  function changeTerms() { requestId.current = crypto.randomUUID(); offer.reset(); setCreated(false) }
  return <section id={`match-bets-${match.id}`} className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5" aria-label={t('matchBets.panel')}>
    <h3 className="font-bold text-green-950">{t('matchBets.panel')}</h3>
    <p className="mb-3 text-sm text-green-900">{t('bets.available')}: <strong>{wallet ? formatPicklePoints(wallet.available) : '—'}</strong></p>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('matchBets.views')}>
      {(['offer', 'offers'] as const).map(tab => <button key={tab} type="button" disabled={pending} aria-pressed={view === tab} onClick={() => onViewChange(tab)} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${view === tab ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800'}`}>{t(tab === 'offer' ? 'bets.create' : 'matchBets.offers', { count: offers.length })}</button>)}
    </div>
    {created ? <p role="status" className="mb-3 text-sm font-semibold text-green-800">{t('bets.created')}</p> : null}
    {status !== 'open' ? <p className="text-sm text-amber-900">{t('matchBets.closed')}</p> : allowedSides.length === 1 ? <p className="mb-3 text-sm text-amber-900">{t('matchBets.ownSideOnly')}</p> : null}
    {view === 'offer' ? <form onSubmit={event => { event.preventDefault(); void reviewCreation() }}>
      <fieldset disabled={pending || !eligible || status !== 'open'}>
        <legend className="mb-2 text-sm font-semibold text-green-950">{t('bets.backSide')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[{ id: match.home_team_id, names: homeNames, chance: probability?.home }, { id: match.away_team_id, names: awayNames, chance: probability ? 1 - probability.home : undefined }].map(side => <button key={side.id} type="button" disabled={!allowedSides.includes(side.id)} aria-pressed={sideId === side.id} onClick={() => { setSideId(side.id); changeTerms() }} className={`min-h-20 min-w-0 rounded-xl border p-3 text-left ${sideId === side.id ? 'border-green-700 bg-green-50 ring-1 ring-green-700' : 'border-gray-200 bg-white hover:bg-green-50'} disabled:cursor-not-allowed disabled:opacity-50`}>
            <span className={`mb-2 block text-xs font-semibold ${sideId === side.id ? 'text-green-700' : 'text-gray-500'}`}>{t(sideId === side.id ? 'betSlip.youBack' : 'matchBets.backPair')}{sideId === side.id ? <span aria-hidden="true"> ✓</span> : null}</span>
            {side.names.map((name, index) => <span key={index} className="block font-semibold text-green-950 [overflow-wrap:anywhere]">{name}</span>)}
            {side.chance != null ? <span className="mt-2 block text-xs text-gray-500">{t('matchBets.chance', { percent: Math.round(side.chance * 100) })}</span> : null}
          </button>)}
        </div>
        <label className="mt-4 block text-sm font-semibold text-green-950" htmlFor={`bet-stake-${match.id}`}>{t('bets.yourStake')}</label>
        <input id={`bet-stake-${match.id}`} type="number" min="1000" max="1000000000000" step="1000" required value={stake} onChange={event => { setStake(event.target.value); changeTerms() }} className={inputClass} />
        {!differentStake ? <p className="mt-2 text-xs text-gray-500">{t('matchBets.equalStake')}</p> : null}
        <details className="mt-3 rounded-xl border border-gray-100 px-3">
          <summary className="min-h-11 content-center text-sm font-semibold text-green-800">{t('betSlip.customTerms')}{differentStake ? <span aria-hidden="true"> · ✓</span> : null}</summary>
          <div className="pb-3">
            <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={differentStake} onChange={event => { setDifferentStake(event.target.checked); if (event.target.checked) setOpponentStake(stake); changeTerms() }} className="size-5 accent-green-700" />{t('matchBets.differentStake')}</label>
            {differentStake ? <label className="mt-2 block text-sm font-semibold text-green-950">{t('bets.otherStake')}<input type="number" min="1000" max="1000000000000" step="1000" required value={opponentStake} onChange={event => { setOpponentStake(event.target.value); changeTerms() }} className={inputClass} /></label> : null}
          </div>
        </details>
        <p className="mt-3 text-xs text-gray-600">{t('bets.stakeHelp')}</p>
        {valid ? <BetTerms stake={stake} profit={otherStake} showStake={false} live /> : null}
        {valid && wallet && !funded ? <p role="alert" className="mt-3 text-sm text-red-700">{t('matchBets.insufficient')}</p> : null}
        <button type="submit" disabled={!allowedSides.includes(sideId) || !valid || !funded} className={buttonClass + ' mt-4 w-full'}>{t('betSlip.reviewCreate')}</button>
      </fieldset>
    </form> : <div className="space-y-3">
      {!offers.length ? <p className="text-sm text-gray-600">{t('matchBets.noOffers')}</p> : offers.map(bet => <BetOfferCard
        key={bet.id} bet={bet} playerId={playerId} wallet={wallet} pending={pending}
        canReview={eligible && canAcceptMatchOffer(match, bet.creatorSide, playerId)}
        unavailableReason={t(!eligible ? 'bets.inactive' : status === 'closed' ? 'matchBets.closed' : 'matchBets.ownSideOnly')}
        onReview={() => { void reviewAcceptance(bet) }}
      />)}
    </div>}
    {offer.error ? <div className="mt-3"><ErrorState message={betErrorMessage(offer.error, t)} /></div> : null}
    {acceptance.error ? <div className="mt-3"><ErrorState message={betErrorMessage(acceptance.error, t)} /></div> : null}
  </section>
}
