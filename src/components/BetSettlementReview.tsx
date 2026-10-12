import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { addPoints, betErrorMessage, confirmSettlement, fetchSettlementPreview } from '../lib/betsApi'
import { recordForfeit, recordResult } from '../lib/api'
import { formatSignedPicklePoints } from '../lib/picklePoints'
import { resultFromScores } from '../lib/matchResultValidation'
import { validateTeamDuelScore } from '../lib/teamDuelSchedule'
import { useConfirm } from '../lib/confirmation'
import type { MatchWithTeams } from '../types'
import { ErrorState } from './Layout'
import { Select } from './Select'
import { resolveMatchLineups } from '../lib/playerMatches'

export function BetSettlementReview({ match }: { match: MatchWithTeams }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const confirm = useConfirm()
  const preview = useQuery({ queryKey: ['bets', 'preview', match.id], queryFn: () => fetchSettlementPreview(match.id), refetchOnWindowFocus: 'always' })
  const [correcting, setCorrecting] = useState(false)
  const [home, setHome] = useState(String(match.home_score ?? ''))
  const [away, setAway] = useState(String(match.away_score ?? ''))
  const [mode, setMode] = useState('completed')
  const [forfeitSide, setForfeitSide] = useState(match.home_team_id)
  const [reason, setReason] = useState('')
  const request = useRef(crypto.randomUUID())
  const ids = resolveMatchLineups(match)
  const names = (players: string[]) => players.map(id => [...(match.home_team.players ?? []),...(match.away_team.players ?? [])].find(p => p.pool_player_id === id)?.name ?? t('personal.unknownPlayer')).join(' + ')
  const refresh = async () => {
    await Promise.all(['bets','pickle-points','matches','player-profile','player-pool','player-rankings'].map(key => client.invalidateQueries({ queryKey: [key] })))
  }
  const pay = useMutation({ mutationFn: async () => {
    if (!preview.data) throw new Error(t('bets.reviewAgain'))
    if (!await confirm(t('bets.confirmHelp'), { title: t('bets.confirmPayout'), confirmLabel: t('bets.confirmPayout') })) return
    await confirmSettlement(preview.data)
  }, onSuccess: refresh })
  const correct = useMutation({ mutationFn: async () => {
    if (!preview.data) throw new Error(t('bets.reviewAgain'))
    const correction = { reason, fingerprint: preview.data.fingerprint, revision: preview.data.revision, requestId: request.current }
    if (mode === 'completed' && (home === '' || away === '')) throw new Error(t('record.validation.scoresRequired'))
    const result = mode === 'completed' ? resultFromScores(match.home_team_id, match.away_team_id, Number(home), Number(away)) : null
    if (mode === 'completed' && match.duel_sequence_number != null) validateTeamDuelScore(Number(home), Number(away))
    const newWinner = result?.winnerTeamId ?? (forfeitSide === match.home_team_id ? match.away_team_id : match.home_team_id)
    const adjustments = preview.data.bets.map(b => {
      // The preview is the current confirmed net result; reversing it and applying
      // the new outcome produces this additional balance change.
      const proposed = mode === 'forfeit' ? '0' : newWinner === b.creatorSide ? b.acceptorStake : '-'+b.creatorStake
      const delta = addPoints(proposed, b.creatorNet.startsWith('-') ? b.creatorNet.slice(1) : '-'+b.creatorNet)
      return `${b.creatorName}: ${formatSignedPicklePoints(delta)} · ${b.acceptorName}: ${formatSignedPicklePoints(delta.startsWith('-') ? delta.slice(1) : '-'+delta)}`
    }).join('\n')
    const resultLabel = mode === 'forfeit' ? t('personal.forfeit') : `${home}–${away}`
    if (!await confirm(`${t('bets.result')}: ${resultLabel}\n${adjustments}\n\n${t('bets.correctionHelp')}`, { title: t('bets.correct'), confirmLabel: t('bets.correct') })) return
    if (result) await recordResult(match.id, { winnerTeamId: result.winnerTeamId, homeScore: result.homeScore, awayScore: result.awayScore }, correction)
    else await recordForfeit(match.id, forfeitSide, match.home_team_id, match.away_team_id, correction)
    request.current = crypto.randomUUID(); setCorrecting(false)
  }, onSuccess: refresh })
  if (preview.isLoading) return <p>{t('common.loading')}</p>
  if (preview.error) return <ErrorState message={betErrorMessage(preview.error, t)} />
  if (!preview.data?.bets.length) return null
  return <article className="rounded-xl border border-amber-200 bg-white p-4">
    <h3 className="break-words font-bold text-green-950">{names(ids.homeIds)} vs {names(ids.awayIds)} · {t('personal.round',{number:match.round_number})}</h3>
    <p className="mt-1 text-sm text-gray-600">{t('bets.result')}: {preview.data.status === 'forfeit' ? t('bets.refunded') : `${preview.data.homeScore}–${preview.data.awayScore}`} · {t('bets.revision',{number:preview.data.revision})}</p>
    <p className="mt-1 text-xs text-gray-600">{t('bets.refundHelp')}</p>
    <ul className="mt-3 space-y-2 text-sm">{preview.data.bets.map(b => <li key={b.id} className="grid gap-1 rounded-lg bg-green-50 p-3 sm:grid-cols-2">
      <span>{b.creatorName}: <strong>{formatSignedPicklePoints(b.creatorNet)}</strong></span><span>{b.acceptorName}: <strong>{formatSignedPicklePoints(b.acceptorNet)}</strong></span>
    </li>)}</ul>
    {preview.data.revision === 0 ? <button type="button" disabled={pay.isPending} onClick={() => pay.mutate()} className="mt-3 min-h-11 rounded-lg bg-green-700 px-4 font-bold text-white disabled:opacity-50">{t('bets.confirmPayout')}</button>
      : <button type="button" onClick={() => { request.current=crypto.randomUUID(); setCorrecting(!correcting) }} className="mt-3 min-h-11 font-bold text-amber-900 underline">{t('bets.correct')}</button>}
    {correcting ? <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); correct.mutate() }}>
      <p className="text-sm text-amber-900">{t('bets.correctionHelp')}</p>
      <label className="block text-sm font-semibold">{t('bets.resultType')}<Select value={mode} onValueChange={value=>{setMode(value);request.current=crypto.randomUUID()}} className="mt-1 min-h-11 w-full rounded-lg border px-3"><option value="completed">{t('bets.played')}</option><option value="forfeit">{t('personal.forfeit')}</option></Select></label>
      {mode === 'completed' ? <div className="grid grid-cols-2 gap-3">{[[match.home_team.name,home,setHome],[match.away_team.name,away,setAway]].map(([name,value,setter],i) => <label key={i} className="text-sm">{name as string}<input type="number" min="0" step="1" required value={value as string} onChange={e => {(setter as (value:string)=>void)(e.target.value);request.current=crypto.randomUUID()}} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label>)}</div>
        : <label className="block text-sm">{t('bets.forfeitingSide')}<Select value={forfeitSide} onValueChange={setForfeitSide} className="mt-1 min-h-11 w-full rounded-lg border px-3"><option value={match.home_team_id}>{match.home_team.name}</option><option value={match.away_team_id}>{match.away_team.name}</option></Select></label>}
      <label className="block text-sm font-semibold">{t('bets.reason')}<textarea required minLength={3} value={reason} onChange={e => {setReason(e.target.value);request.current=crypto.randomUUID()}} className="mt-1 w-full rounded-lg border p-3" /></label>
      <button disabled={correct.isPending || reason.trim().length<3} className="min-h-11 rounded-lg bg-amber-700 px-4 font-bold text-white disabled:opacity-50">{t('bets.correct')}</button>
    </form> : null}
    {pay.error || correct.error ? <ErrorState message={betErrorMessage(pay.error || correct.error, t)} /> : null}
  </article>
}
