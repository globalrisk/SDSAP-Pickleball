import { useConfirm } from '../lib/confirmation'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { clearUnplayedLeagueDuelFixtures, fetchLeagueDuelDraftPreview, generateLeagueDuelSeasonMatches, saveLeagueDuelDraft } from '../lib/leagueTeamDuelApi'
import { LEAGUE_DUEL_ROSTER_SIZES } from '../lib/leagueTeamDuel'
import { duelOpponentMeetingCaps, duelTierForRank } from '../lib/leagueDuelSchedule'
import { DUEL_DRAFT_PRIORITIES, createDuelDraftOptions, refreshDuelDraftOptions, isSelectedDuelDraftSaved, type DuelDraftOptions } from '../lib/duelDraftOptions'
import { ErrorState } from './Layout'
import { LeagueDuelTeamNameForm } from './LeagueDuelTeamNameForm'
import { seasonRosterQueryKey } from '../lib/seasonRosterApi'
import { SeasonForecastSummary } from './SeasonForecastSummary'
import type { DuelDraftPriority, MatchWithTeams, Season, TeamWithPlayers } from '../types'

const buttonClass = 'min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50'

export function LeagueTeamDuelSetup({ season, rosterIds, teams, fixtures, hasFixtures, editable }: {
  season: Season; rosterIds: string[]; teams: TeamWithPlayers[]; fixtures: MatchWithTeams[] | undefined; hasFixtures: boolean; editable: boolean
}) {
  const confirm = useConfirm()
  const { t } = useTranslation()
  const { league, leaguePath } = useLeague()
  const client = useQueryClient()
  const defaultPriority = season.duel_draft_priority ?? (teams.length ? 'opponent_variety' : 'balance')
  const [selection, setSelection] = useState<{ seasonId: string; priority: DuelDraftPriority }>({ seasonId: season.id, priority: defaultPriority })
  const selectedPriority = selection.seasonId === season.id ? selection.priority : defaultPriority
  const [options, setOptions] = useState<DuelDraftOptions | null>(null)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const interacted = useRef(false)
  const [names, setNames] = useState<[string, string]>([t('leagueDuel.squadA'), t('leagueDuel.squadB')])
  const validSize = (LEAGUE_DUEL_ROSTER_SIZES as readonly number[]).includes(rosterIds.length)
  const meetingCaps = validSize ? duelOpponentMeetingCaps(rosterIds.length / 2) : undefined
  const needsTierDraft = teams.length > 0 && !hasFixtures && (season.duel_schedule_mode !== 'tier_matched'
    || season.duel_draft_rating_revision == null || !season.duel_draft_rating_fingerprint)
  const canClear = editable && !!fixtures?.length && fixtures.every((match) => match.status === 'scheduled'
    && match.home_score == null && match.away_score == null && match.winner_team_id == null
    && match.result_recorded_at == null && match.live_status !== 'playing')
  const preview = useQuery({
    queryKey: ['league-duel-draft', season.id, [...rosterIds].sort().join(':')],
    queryFn: () => fetchLeagueDuelDraftPreview(league.id, season.id, rosterIds),
    enabled: editable && !hasFixtures && validSize,
    staleTime: 0,
  })
  const savedCandidate = preview.data?.candidates[season.duel_draft_priority ?? 'opponent_variety']
    .find((draft) => isSelectedDuelDraftSaved(draft, season, teams, preview.data))
  const currentOptions = preview.data ? options?.snapshotKey === preview.data.snapshotKey ? options
    : createDuelDraftOptions(preview.data.snapshotKey, preview.data.candidates, savedCandidate) : null
  useEffect(() => {
    if (preview.data) setOptions((previous) => {
      if (previous?.snapshotKey === preview.data.snapshotKey) {
        if (!interacted.current && savedCandidate && previous.drafts.find((draft) => draft.priority === savedCandidate.priority)?.id !== savedCandidate.id) {
          return createDuelDraftOptions(preview.data.snapshotKey, preview.data.candidates, savedCandidate)
        }
        return previous
      }
      interacted.current = false
      return createDuelDraftOptions(preview.data.snapshotKey, preview.data.candidates, savedCandidate)
    })
    if (preview.isSuccess) setRefreshFailed(false)
  }, [preview.data, preview.isSuccess, savedCandidate])
  const selected = currentOptions?.drafts.find((draft) => draft.priority === selectedPriority)
  const selectionSaved = isSelectedDuelDraftSaved(selected, season, teams, preview.data)
  const previewUnavailable = preview.isError || refreshFailed || preview.isFetching
  async function refreshOptions() {
    interacted.current = true
    const previous = currentOptions
    save.reset(); generate.reset()
    const result = await preview.refetch()
    if (result.isError || !result.data) { setRefreshFailed(true); return }
    setRefreshFailed(false)
    const data = result.data
    client.setQueryData(seasonRosterQueryKey(season.id), data.rosterIds)
    setOptions(previous ? refreshDuelDraftOptions(previous, data.snapshotKey, data.candidates)
      : createDuelDraftOptions(data.snapshotKey, data.candidates))
  }
  async function invalidate() {
    await Promise.all(['teams', 'teams-with-players', 'matches', 'seasons', 'assigned-pool-players'].map((key) => client.invalidateQueries({ queryKey: [key] })))
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !preview.data || previewUnavailable) throw new Error(t('leagueDuel.selectDraft'))
      await saveLeagueDuelDraft(season.id, selected, names, preview.data.revision, preview.data.fingerprint)
    },
    onSuccess: invalidate,
    onError: (error: Error) => { if (error.message.includes('DUEL_STALE_DRAFT')) void preview.refetch() },
  })
  const generate = useMutation({
    mutationFn: () => {
      if (!selectionSaved || previewUnavailable) throw new Error(t('leagueDuel.saveBeforeGenerate'))
      return generateLeagueDuelSeasonMatches(season.id)
    },
    onSuccess: invalidate,
    onError: (error: Error) => { if (error.message.includes('DUEL_STALE_DRAFT')) void preview.refetch() },
  })
  const clear = useMutation({
    mutationFn: (ids: string[]) => clearUnplayedLeagueDuelFixtures(season.id, ids),
    onSuccess: async () => {
      save.reset(); generate.reset(); setOptions(null)
      await invalidate()
    },
    onError: () => { void invalidate() },
  })
  const actionError = clear.error ?? save.error ?? generate.error

  return <section className="mb-8 space-y-4 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-bold text-green-950">{t('leagueDuel.title')}</h2>
    <p className="text-sm text-gray-600">{t('leagueDuel.rules')}</p>
    {teams.length > 0 ? <div className="grid gap-4 sm:grid-cols-2">
      {teams.map((team) => <div key={team.id} className="rounded-lg border border-green-100 p-3">
        <h3 className="font-bold" style={{ color: team.color }}>{team.name}</h3>
        {editable ? <LeagueDuelTeamNameForm team={team} disabled={save.isPending || generate.isPending || clear.isPending} /> : null}
        <ol className="mt-2 space-y-1 text-sm">{[...team.players].sort((a, b) => (a.duel_rank ?? 0) - (b.duel_rank ?? 0)).map((player) =>
          <li key={player.id}>#{player.duel_rank} {player.name}{player.duel_tier ? <span className="ml-2 rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">{t(`leagueDuel.tier.${player.duel_tier}`)}</span> : null}</li>)}</ol>
      </div>)}
    </div> : null}
    {editable && teams.length > 0 ? <p className="text-sm text-gray-600">{t('leagueDuel.renameHelp')}</p> : null}
    {teams.length > 0 ? <p className="text-sm font-semibold text-green-900">{t('leagueDuel.savedPriority', { priority: t(`leagueDuel.priority.${season.duel_draft_priority ?? 'opponent_variety'}`) })}</p> : null}
    {hasFixtures ? <p className="text-sm font-semibold text-green-800">{t('leagueDuel.frozen')}</p> : null}
    {editable && hasFixtures && fixtures?.length ? <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="mb-3 text-sm text-red-900">{t(canClear ? 'leagueDuel.clearHelp' : 'leagueDuel.clearBlocked')}</p>
      <button type="button" disabled={!canClear || clear.isPending || save.isPending || generate.isPending}
        onClick={async () => {
          const ids = fixtures.map((match) => match.id)
          if (await confirm(t('leagueDuel.clearConfirm', { name: season.name, count: ids.length }), { tone: 'danger' })) clear.mutate(ids)
        }} className="min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50">
        {clear.isPending ? t('common.loading') : t('leagueDuel.clearFixtures')}
      </button>
    </div> : null}
    {clear.isSuccess ? <p role="status" className="text-sm text-green-800">{t('leagueDuel.clearSuccess', { count: clear.data })}</p> : null}
    {editable && !hasFixtures ? <>
      {needsTierDraft ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('leagueDuel.rebuildDraft')}</p> : null}
      {!validSize ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('leagueDuel.rosterSize', { count: rosterIds.length })}</p> : <>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-green-950">{t('leagueDuel.draftTitle')}</h3>
          <button type="button" disabled={preview.isFetching || save.isPending || generate.isPending || clear.isPending} onClick={() => void refreshOptions()} className="min-h-11 rounded-lg border border-green-200 px-3 py-2 text-sm font-semibold text-green-800">{t('leagueDuel.refresh')}</button>
        </div>
        {preview.isFetching ? <p role="status">{t('common.loading')}</p> : null}
        {preview.error ? <ErrorState message={(preview.error as Error).message} /> : null}
        <p className="text-sm text-green-900">{t('leagueDuel.tierComposition')}</p>
        <p className="text-xs text-gray-600">{t('leagueDuel.balanceHelp')}</p>
        <p className="text-xs font-semibold text-green-900">{t('leagueDuel.seasonBalanceLimit')}</p>
        {meetingCaps ? <p className="text-xs text-gray-600">{t('leagueDuel.opponentLimits', meetingCaps)}</p> : null}
        <p className="text-xs text-gray-600">{t('leagueDuel.refreshHelp')}</p>
        {currentOptions?.drafts.length === 2 && currentOptions.drafts[0]!.splitId === currentOptions.drafts[1]!.splitId ? <p className="text-sm text-gray-600">{t('leagueDuel.sameSquads')}</p> : null}
        <div className="space-y-3">{currentOptions ? DUEL_DRAFT_PRIORITIES.map((priority) => {
          const draft = currentOptions.drafts.find(draft => draft.priority === priority)
          if (!draft) return <label key={priority} className="block rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center gap-3"><input type="radio" name="duel-draft" value={priority} checked={false} disabled className="size-5" /><span className="font-semibold">{t(`leagueDuel.priority.${priority}`)}</span></div>
            <p role="status" className="mt-2 text-sm text-amber-800">{t('leagueDuel.noEligible')}</p>
          </label>
          return <label key={priority} className={`block cursor-pointer rounded-lg border p-4 ${draft.id === selected?.id ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3"><input type="radio" name="duel-draft" value={draft.id} checked={draft.id === selected?.id} onChange={() => { interacted.current = true; setSelection({ seasonId: season.id, priority: draft.priority }); save.reset(); generate.reset() }} disabled={save.isPending || generate.isPending || preview.isFetching} className="size-5 accent-green-700" /><span className="font-semibold">{t(`leagueDuel.priority.${draft.priority}`)}</span></div>
          <p className="mt-2 text-xs text-gray-600">{t(`leagueDuel.priorityHelp.${draft.priority}`)}</p>
          <p className="mt-2 text-sm">{t('leagueDuel.draftMetrics', { percent: (draft.worstFavorite * 100).toFixed(1), meetings: draft.schedule.opponentEncounterCounts[0], repeats: draft.repeatedPartnerships })}</p>
          <div className="mt-2"><SeasonForecastSummary forecast={draft.schedule.seasonForecast} names={[t('leagueDuel.squadA'), t('leagueDuel.squadB')]} /></div>
          {currentOptions.notices[draft.priority] ? <p role="status" className="mt-2 text-sm text-amber-800">{t(`leagueDuel.${currentOptions.notices[draft.priority]}`)}</p> : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{draft.squads.map((squad, side) => <div key={side}><p className="text-sm font-bold">{t(side === 0 ? 'leagueDuel.squadA' : 'leagueDuel.squadB')}</p><ol className="mt-1 space-y-1 text-sm">{squad.map((player, rank) => <li key={player.id}>#{rank + 1} {player.name} <span className="text-gray-500">({Math.round(player.rating)})</span> <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">{t(`leagueDuel.tier.${duelTierForRank(rank + 1, squad.length)}`)}</span></li>)}</ol></div>)}</div>
        </label>}) : null}</div>
        <div className="grid gap-3 sm:grid-cols-2">{names.map((name, side) => <label key={side} className="text-sm font-semibold">{t(side === 0 ? 'leagueDuel.nameA' : 'leagueDuel.nameB')}<input value={name} maxLength={120} disabled={save.isPending || generate.isPending} onChange={(e) => setNames((current) => side === 0 ? [e.target.value, current[1]] : [current[0], e.target.value])} className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3 py-2" /></label>)}</div>
        <button type="button" className={buttonClass} disabled={!selected || previewUnavailable || save.isPending || generate.isPending || clear.isPending || names.some((name) => !name.trim())} onClick={() => { clear.reset(); generate.reset(); save.mutate() }}>{save.isPending ? t('common.loading') : t('leagueDuel.saveDraft')}</button>
        {save.isSuccess ? <p role="status" className="text-sm text-green-800">{t('leagueDuel.draftSaved')}</p> : null}
        {teams.length === 2 ? <div className="border-t border-green-100 pt-4"><p className="mb-3 text-sm text-gray-600">{t('leagueDuel.generateHelp', { games: rosterIds.length / 2 * (rosterIds.length / 2 - 1) / 2, appearances: rosterIds.length / 2 - 1 })}</p>{!selectionSaved ? <p className="mb-3 text-sm text-amber-800">{t('leagueDuel.saveBeforeGenerate')}</p> : null}<button type="button" className={buttonClass} disabled={needsTierDraft || !selectionSaved || previewUnavailable || generate.isPending || save.isPending || clear.isPending} onClick={() => generate.mutate()}>{generate.isPending ? t('common.loading') : t('leagueDuel.generate')}</button></div> : null}
      </>}
      <Link to={leaguePath('/setup?section=season')} className="inline-block text-sm font-semibold text-green-800 underline">{t('setup.seasonRosterManage')}</Link>
    </> : null}
    {actionError ? <ErrorState message={actionError.message.includes('DUEL_STALE_DRAFT') ? t('leagueDuel.staleDraft')
      : actionError.message.includes('DUEL_SEASON_BALANCE') ? t('leagueDuel.seasonBalanceRequired')
      : actionError.message.includes('DUEL_CLEAR_BLOCKED') ? t('leagueDuel.clearBlocked')
        : actionError.message.includes('DUEL_CLEAR_STALE') ? t('leagueDuel.clearStale') : actionError.message} /> : null}
    {hasFixtures ? <Link to={leaguePath('/matches')} className="inline-block text-sm font-semibold text-green-800 underline">{t('leagueDuel.viewGames')}</Link> : null}
  </section>
}
