import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { clearUnplayedLeagueDuelFixtures, fetchLeagueDuelDraftPreview, generateLeagueDuelSeasonMatches, saveLeagueDuelDraft } from '../lib/leagueTeamDuelApi'
import { LEAGUE_DUEL_ROSTER_SIZES } from '../lib/leagueTeamDuel'
import { duelTierForRank } from '../lib/leagueDuelSchedule'
import { ErrorState } from './Layout'
import type { MatchWithTeams, Season, TeamWithPlayers } from '../types'

const buttonClass = 'min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50'

export function LeagueTeamDuelSetup({ season, rosterIds, teams, fixtures, hasFixtures, editable }: {
  season: Season; rosterIds: string[]; teams: TeamWithPlayers[]; fixtures: MatchWithTeams[] | undefined; hasFixtures: boolean; editable: boolean
}) {
  const { t } = useTranslation()
  const { league, leaguePath } = useLeague()
  const client = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [names, setNames] = useState<[string, string]>([t('leagueDuel.squadA'), t('leagueDuel.squadB')])
  const validSize = (LEAGUE_DUEL_ROSTER_SIZES as readonly number[]).includes(rosterIds.length)
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
  const selected = preview.data?.drafts.find((draft) => draft.id === selectedId) ?? preview.data?.drafts[0]
  async function invalidate() {
    await Promise.all(['teams', 'teams-with-players', 'matches', 'seasons', 'assigned-pool-players'].map((key) => client.invalidateQueries({ queryKey: [key] })))
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!selected || !preview.data || preview.isError) throw new Error(t('leagueDuel.selectDraft'))
      await saveLeagueDuelDraft(season.id, selected, names, preview.data.revision, preview.data.fingerprint)
    },
    onSuccess: invalidate,
    onError: (error: Error) => { if (error.message.includes('DUEL_STALE_DRAFT')) void preview.refetch() },
  })
  const generate = useMutation({
    mutationFn: () => generateLeagueDuelSeasonMatches(season.id),
    onSuccess: invalidate,
    onError: (error: Error) => { if (error.message.includes('DUEL_STALE_DRAFT')) void preview.refetch() },
  })
  const clear = useMutation({
    mutationFn: (ids: string[]) => clearUnplayedLeagueDuelFixtures(season.id, ids),
    onSuccess: async () => {
      save.reset(); generate.reset(); setSelectedId(null)
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
        <ol className="mt-2 space-y-1 text-sm">{[...team.players].sort((a, b) => (a.duel_rank ?? 0) - (b.duel_rank ?? 0)).map((player) =>
          <li key={player.id}>#{player.duel_rank} {player.name}{player.duel_tier ? <span className="ml-2 rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">{t(`leagueDuel.tier.${player.duel_tier}`)}</span> : null}</li>)}</ol>
      </div>)}
    </div> : null}
    {hasFixtures ? <p className="text-sm font-semibold text-green-800">{t('leagueDuel.frozen')}</p> : null}
    {editable && hasFixtures && fixtures?.length ? <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="mb-3 text-sm text-red-900">{t(canClear ? 'leagueDuel.clearHelp' : 'leagueDuel.clearBlocked')}</p>
      <button type="button" disabled={!canClear || clear.isPending || save.isPending || generate.isPending}
        onClick={() => {
          const ids = fixtures.map((match) => match.id)
          if (confirm(t('leagueDuel.clearConfirm', { name: season.name, count: ids.length }))) clear.mutate(ids)
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
          <button type="button" disabled={preview.isFetching || save.isPending || generate.isPending} onClick={() => { save.reset(); generate.reset(); void preview.refetch() }} className="min-h-11 rounded-lg border border-green-200 px-3 py-2 text-sm font-semibold text-green-800">{t('leagueDuel.refresh')}</button>
        </div>
        {preview.isFetching ? <p role="status">{t('common.loading')}</p> : null}
        {preview.error ? <ErrorState message={(preview.error as Error).message} /> : null}
        {selected?.meetsTarget === false ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('leagueDuel.imbalanceWarning')}</p> : null}
        <p className="text-sm text-green-900">{t('leagueDuel.tierComposition')}</p>
        <p className="text-xs text-gray-600">{t('leagueDuel.balanceHelp')}</p>
        <div className="space-y-3">{preview.data?.drafts.map((draft, index) => <label key={draft.id} className={`block cursor-pointer rounded-lg border p-4 ${draft.id === selected?.id ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3"><input type="radio" name="duel-draft" value={draft.id} checked={draft.id === selected?.id} onChange={() => setSelectedId(draft.id)} disabled={save.isPending || generate.isPending} className="size-5 accent-green-700" /><span className="font-semibold">{t('leagueDuel.option', { number: index + 1 })}</span></div>
          <p className="mt-2 text-sm">{t('leagueDuel.balance', { percent: (draft.worstFavorite * 100).toFixed(1), repeats: draft.repeatedPartnerships })}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{draft.squads.map((squad, side) => <div key={side}><p className="text-sm font-bold">{t(side === 0 ? 'leagueDuel.squadA' : 'leagueDuel.squadB')}</p><ol className="mt-1 space-y-1 text-sm">{squad.map((player, rank) => <li key={player.id}>#{rank + 1} {player.name} <span className="text-gray-500">({Math.round(player.rating)})</span> <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">{t(`leagueDuel.tier.${duelTierForRank(rank + 1, squad.length)}`)}</span></li>)}</ol></div>)}</div>
        </label>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">{names.map((name, side) => <label key={side} className="text-sm font-semibold">{t(side === 0 ? 'leagueDuel.nameA' : 'leagueDuel.nameB')}<input value={name} maxLength={120} disabled={save.isPending || generate.isPending} onChange={(e) => setNames((current) => side === 0 ? [e.target.value, current[1]] : [current[0], e.target.value])} className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3 py-2" /></label>)}</div>
        <button type="button" className={buttonClass} disabled={!selected || preview.isError || preview.isFetching || save.isPending || generate.isPending || clear.isPending || names.some((name) => !name.trim())} onClick={() => { clear.reset(); generate.reset(); save.mutate() }}>{save.isPending ? t('common.loading') : t('leagueDuel.saveDraft')}</button>
        {save.isSuccess ? <p role="status" className="text-sm text-green-800">{t('leagueDuel.draftSaved')}</p> : null}
        {teams.length === 2 ? <div className="border-t border-green-100 pt-4"><p className="mb-3 text-sm text-gray-600">{t('leagueDuel.generateHelp', { games: rosterIds.length / 2 * (rosterIds.length / 2 - 1) / 2, appearances: rosterIds.length / 2 - 1 })}</p><button type="button" className={buttonClass} disabled={needsTierDraft || generate.isPending || save.isPending} onClick={() => generate.mutate()}>{generate.isPending ? t('common.loading') : t('leagueDuel.generate')}</button></div> : null}
      </>}
      <Link to={leaguePath('/setup?section=season')} className="inline-block text-sm font-semibold text-green-800 underline">{t('setup.seasonRosterManage')}</Link>
    </> : null}
    {actionError ? <ErrorState message={actionError.message.includes('DUEL_STALE_DRAFT') ? t('leagueDuel.staleDraft')
      : actionError.message.includes('DUEL_CLEAR_BLOCKED') ? t('leagueDuel.clearBlocked')
        : actionError.message.includes('DUEL_CLEAR_STALE') ? t('leagueDuel.clearStale') : actionError.message} /> : null}
    {hasFixtures ? <Link to={leaguePath('/matches')} className="inline-block text-sm font-semibold text-green-800 underline">{t('leagueDuel.viewGames')}</Link> : null}
  </section>
}
