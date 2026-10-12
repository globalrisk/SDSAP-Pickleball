import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { acceptBet, addPoints, betErrorMessage, createBet, isBetStake, type PickleBet, type PickleWallet } from '../lib/betsApi'
import { formatPicklePoints } from '../lib/picklePoints'
import { resolveMatchLineups } from '../lib/playerMatches'
import { hasBetFunds, matchBettingStatus } from '../lib/matchBetting'
import { calculateMatchProbability } from '../lib/matchProbability'
import { useConfirm } from '../lib/confirmation'
import type { MatchWithTeams, PoolPlayer } from '../types'
import { ErrorState } from './Layout'

const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base'
const buttonClass = 'min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50'

export function MatchBetPanel({ match, playerId, wallet, pool, offers, view, onViewChange, onClose, eligible }: {
  match: MatchWithTeams; playerId?: string; wallet?: PickleWallet; pool: PoolPlayer[]; offers: PickleBet[]
  view: 'offer' | 'offers'; onViewChange: (view: 'offer' | 'offers') => void; onClose: () => void; eligible: boolean
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const client = useQueryClient()
  const [sideId, setSideId] = useState('')
  const [stake, setStake] = useState('1000')
  const [differentStake, setDifferentStake] = useState(false)
  const [opponentStake, setOpponentStake] = useState('1000')
  const [created, setCreated] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const acceptIds = useRef(new Map<string, string>())
  const { homeIds, awayIds } = resolveMatchLineups(match)
  const names = (ids: string[]) => ids.map(id => pool.find(p => p.id === id)?.name
    ?? [...(match.home_team.players ?? []), ...(match.away_team.players ?? [])].find(p => p.pool_player_id === id)?.name
    ?? t('personal.unknownPlayer')).join(' + ')
  const homeName = names(homeIds)
  const awayName = names(awayIds)
  const otherStake = differentStake ? opponentStake : stake
  const status = matchBettingStatus(match, playerId)
  const probability = calculateMatchProbability(match.home_team, match.away_team)
  const valid = isBetStake(stake) && isBetStake(otherStake)
  const funded = hasBetFunds(wallet?.available, stake)
  const refresh = () => Promise.all(['bets', 'pickle-points', 'matches'].map(key => client.invalidateQueries({ queryKey: [key] })))
  const offer = useMutation({
    mutationFn: async () => {
      if (!eligible || status !== 'open' || ![match.home_team_id, match.away_team_id].includes(sideId) || !valid) throw new Error(t('bets.invalidStake'))
      if (!funded) throw new Error(t('matchBets.insufficient'))
      const terms = `${homeName} vs ${awayName}\n${t('bets.backSide')}: ${sideId === match.home_team_id ? homeName : awayName}\n\n${t('bets.offerConfirm', { stake: formatPicklePoints(stake), other: formatPicklePoints(otherStake) })}`
      if (!await confirm(terms, { title: t('bets.create'), confirmLabel: t('bets.create') })) return false
      await createBet(match.id, sideId, stake, otherStake, requestId.current)
      return true
    },
    onSuccess: async saved => {
      if (saved) { requestId.current = crypto.randomUUID(); setCreated(true); setSideId('') }
      await refresh()
    },
  })
  const acceptance = useMutation({
    mutationFn: async (bet: PickleBet) => {
      if (!eligible || status !== 'open' || bet.creatorId === playerId || bet.state !== 'open' || bet.matchId !== match.id) throw new Error(t('matchBets.closed'))
      if (!hasBetFunds(wallet?.available, bet.acceptorStake)) throw new Error(t('matchBets.insufficient'))
      const pair = (bet.creatorSide === bet.homeTeamId ? bet.awayNames : bet.homeNames).join(' + ')
      if (!await confirm(`${t('bets.backSide')}: ${pair}\n\n${t('bets.acceptConfirm', { stake: formatPicklePoints(bet.acceptorStake), pot: formatPicklePoints(addPoints(bet.creatorStake, bet.acceptorStake)) })}`, { title: t('bets.accept'), confirmLabel: t('bets.accept') })) return
      let id = acceptIds.current.get(bet.id)
      if (!id) { id = crypto.randomUUID(); acceptIds.current.set(bet.id, id) }
      await acceptBet(bet.id, id)
    },
    onSuccess: refresh,
  })
  const pending = offer.isPending || acceptance.isPending
  function changeTerms() { requestId.current = crypto.randomUUID(); offer.reset(); setCreated(false) }
  return <section className="mt-4 rounded-xl border border-green-200 bg-green-50/50 p-4" aria-label={t('matchBets.panel')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-bold text-green-950">{t('matchBets.panel')}</h3>
      <button type="button" disabled={pending} onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-green-800 disabled:opacity-50">{t('common.close')}</button>
    </div>
    <p className="mb-3 text-sm text-green-900">{t('bets.available')}: <strong>{wallet ? formatPicklePoints(wallet.available) : '—'}</strong></p>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('matchBets.views')}>
      {(['offer', 'offers'] as const).map(tab => <button key={tab} type="button" disabled={pending} aria-pressed={view === tab} onClick={() => onViewChange(tab)} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${view === tab ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800'}`}>{t(tab === 'offer' ? 'bets.create' : 'matchBets.offers', { count: offers.length })}</button>)}
    </div>
    {created ? <p role="status" className="mb-3 text-sm font-semibold text-green-800">{t('bets.created')}</p> : null}
    {status !== 'open' ? <p className="text-sm text-amber-900">{t(status === 'participant' ? 'matchBets.participant' : 'matchBets.closed')}</p> : null}
    {view === 'offer' ? <form onSubmit={event => { event.preventDefault(); if (!pending) offer.mutate() }}>
      <fieldset disabled={pending || !eligible || status !== 'open'}>
        <legend className="mb-2 text-sm font-semibold text-green-950">{t('bets.backSide')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[{ id: match.home_team_id, name: homeName, chance: probability?.home }, { id: match.away_team_id, name: awayName, chance: probability ? 1 - probability.home : undefined }].map(side => <button key={side.id} type="button" aria-pressed={sideId === side.id} onClick={() => { setSideId(side.id); changeTerms() }} className={`min-h-20 min-w-0 rounded-lg border p-3 text-left ${sideId === side.id ? 'border-green-700 bg-green-100 ring-1 ring-green-700' : 'border-green-200 bg-white hover:bg-green-50'}`}>
            <span className="block break-words font-semibold text-green-950">{side.name}</span><span className="mt-1 block text-xs text-green-800">{side.chance == null ? t('matchBets.backPair') : t('matchBets.chance', { percent: Math.round(side.chance * 100) })}</span>
          </button>)}
        </div>
        <label className="mt-4 block text-sm font-semibold text-green-950" htmlFor={`bet-stake-${match.id}`}>{t('bets.yourStake')}</label>
        <input id={`bet-stake-${match.id}`} type="number" min="1000" max="1000000000000" step="1000" required value={stake} onChange={event => { setStake(event.target.value); changeTerms() }} className={inputClass} />
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-green-900"><input type="checkbox" checked={differentStake} onChange={event => { setDifferentStake(event.target.checked); if (event.target.checked) setOpponentStake(stake); changeTerms() }} className="size-5 accent-green-700" />{t('matchBets.differentStake')}</label>
        {differentStake ? <label className="mt-2 block text-sm font-semibold text-green-950">{t('bets.otherStake')}<input type="number" min="1000" max="1000000000000" step="1000" required value={opponentStake} onChange={event => { setOpponentStake(event.target.value); changeTerms() }} className={inputClass} /></label> : <p className="text-xs text-gray-600">{t('matchBets.equalStake')}</p>}
        <p className="mt-3 text-xs text-gray-600">{t('bets.stakeHelp')}</p>
        {valid ? <dl aria-live="polite" className="mt-4 space-y-2 rounded-lg bg-white p-3 text-sm">
          {[[t('bets.pot'), addPoints(stake, otherStake)], [t('bets.yourProfit'), otherStake], [t('bets.otherProfit'), stake]].map(([label, amount]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd className="font-semibold">{formatPicklePoints(amount!)}</dd></div>)}
        </dl> : null}
        {valid && wallet && !funded ? <p role="alert" className="mt-3 text-sm text-red-700">{t('matchBets.insufficient')}</p> : null}
        <button type="submit" disabled={!sideId || !valid || !funded} className={buttonClass + ' mt-4 w-full'}>{t('bets.create')}</button>
      </fieldset>
    </form> : <div className="space-y-3">
      {!offers.length ? <p className="text-sm text-gray-600">{t('matchBets.noOffers')}</p> : offers.map(bet => <article key={bet.id} className="rounded-lg border border-green-200 bg-white p-3">
        <p className="break-words text-sm font-semibold text-green-950">{t('bets.backedBy', { name: bet.creatorName, pair: (bet.creatorSide === bet.homeTeamId ? bet.homeNames : bet.awayNames).join(' + ') })}</p>
        <p className="mt-2 break-words text-sm text-green-900">{t('matchBets.youBack', { pair: (bet.creatorSide === bet.homeTeamId ? bet.awayNames : bet.homeNames).join(' + ') })}</p>
        <dl className="mt-3 space-y-1 text-sm">{[[t('bets.yourStake'), bet.acceptorStake], [t('bets.yourProfit'), bet.creatorStake], [t('bets.pot'), addPoints(bet.creatorStake, bet.acceptorStake)]].map(([label, amount]) => <div key={label} className="flex flex-wrap justify-between gap-2"><dt>{label}</dt><dd className="font-semibold">{formatPicklePoints(amount!)}</dd></div>)}</dl>
        {bet.creatorId === playerId ? <p className="mt-3 text-xs text-gray-600">{t('matchBets.yourOffer')}</p> : <>
          <button type="button" disabled={pending || !eligible || status !== 'open' || !hasBetFunds(wallet?.available, bet.acceptorStake)} onClick={() => acceptance.mutate(bet)} className={buttonClass + ' mt-3 w-full'}>{t('bets.accept')}</button>
          {wallet && !hasBetFunds(wallet.available, bet.acceptorStake) ? <p className="mt-2 text-xs text-red-700">{t('matchBets.insufficient')}</p> : null}
        </>}
      </article>)}
    </div>}
    {offer.error ? <div className="mt-3"><ErrorState message={betErrorMessage(offer.error, t)} /></div> : null}
    {acceptance.error ? <div className="mt-3"><ErrorState message={betErrorMessage(acceptance.error, t)} /></div> : null}
  </section>
}
