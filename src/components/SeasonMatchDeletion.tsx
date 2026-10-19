import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../lib/confirmation'
import { formatPicklePoints } from '../lib/picklePoints'
import { deleteSeasonMatchesAndBets, fetchSeasonMatchDeletionPreview, type SeasonMatchDeletionPreview } from '../lib/seasonMatchDeletionApi'
import type { MatchWithTeams, Season } from '../types'
import { ErrorState } from './Layout'

export function SeasonMatchDeletionSummary({ preview }: { preview: SeasonMatchDeletionPreview }) {
  const { t } = useTranslation()
  return <div className="space-y-2 text-sm">
    <p>{t('seasonDelete.counts', { matches: preview.matchCount, bets: preview.betCount, open: preview.openCount, accepted: preview.acceptedCount })}</p>
    <p>{t('seasonDelete.release', { amount: formatPicklePoints(preview.releasedPoints) })}</p>
    <p>{t('seasonDelete.preserve')}</p>
  </div>
}

export function SeasonMatchDeletion({ season, fixtures, busy = false, onCleared }: {
  season: Season; fixtures: MatchWithTeams[]; busy?: boolean; onCleared?: () => void
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const client = useQueryClient()
  const canDelete = season.status === 'active' && fixtures.length > 0 && fixtures.every(match =>
    match.status === 'scheduled' && match.live_status !== 'playing' && match.home_score == null
    && match.away_score == null && match.winner_team_id == null && match.result_recorded_at == null)
  const deletion = useMutation({
    mutationFn: async () => {
      const preview = await fetchSeasonMatchDeletionPreview(season.id)
      if (!preview.canDelete) throw new Error(t('seasonDelete.blocked'))
      if (!await confirm(t('seasonDelete.confirm', { name: season.name }), {
        title: t('seasonDelete.title'), confirmLabel: t('seasonDelete.button'), tone: 'danger',
        details: <SeasonMatchDeletionSummary preview={preview} />,
      })) return null
      return deleteSeasonMatchesAndBets(preview, crypto.randomUUID())
    },
    onSuccess: async result => {
      if (!result) return
      onCleared?.()
      await Promise.all(['matches', 'bets', 'pickle-points', 'seasons', 'teams', 'teams-with-players', 'league-duel-draft']
        .map(key => client.invalidateQueries({ queryKey: [key] })))
    },
    onError: () => { void client.invalidateQueries({ queryKey: ['matches'] }) },
  })
  const error = deletion.error
  const message = error?.message.includes('SEASON_DELETE_STALE') ? t('seasonDelete.stale')
    : error?.message.includes('SEASON_DELETE_BLOCKED') ? t('seasonDelete.blocked') : error?.message
  return <details className="rounded-lg border border-red-200 p-4">
    <summary className="min-h-11 cursor-pointer text-sm font-semibold text-red-900">{t('workspace.advancedFixtures')}</summary>
    <p className="mb-3 text-sm text-red-900">{t(canDelete ? 'seasonDelete.help' : 'seasonDelete.blocked')}</p>
    <button type="button" disabled={!canDelete || busy || deletion.isPending} onClick={() => deletion.mutate()}
      className="min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50">
      {deletion.isPending ? t('common.loading') : t('seasonDelete.button')}
    </button>
    {deletion.data ? <p role="status" className="mt-3 text-sm text-green-800">{t('seasonDelete.success', { matches: deletion.data.matchCount, bets: deletion.data.betCount })}</p> : null}
    {message ? <div className="mt-3"><ErrorState message={message} /></div> : null}
  </details>
}
