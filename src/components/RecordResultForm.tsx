import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { recordForfeit, recordResult, revertMatchToScheduled } from '../lib/api'
import { useSeason } from '../context/SeasonContext'
import { useUndoResult } from '../context/undoResult'
import type { MatchWithTeams } from '../types'

interface RecordResultFormProps {
  match: MatchWithTeams
  editing?: boolean
  onDone?: () => void
  compact?: boolean
  onSaved?: (result: SavedMatchResult) => void
}

export interface SavedMatchResult {
  type: 'result' | 'forfeit' | 'revert'
  winnerTeamId: string | null
}

const btnPrimary =
  'min-h-11 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2'
const btnSecondary =
  'min-h-11 w-full rounded-lg border border-red-300 px-4 py-3 text-sm text-red-600 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 sm:py-1.5 sm:text-xs'
const btnGhost =
  'min-h-11 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-600 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 sm:py-2'
const inputClass =
  'min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm'

export function RecordResultForm({
  match,
  editing = false,
  onDone,
  compact = false,
  onSaved,
}: RecordResultFormProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { selectedSeason } = useSeason()
  const { offerUndo } = useUndoResult()
  const [homeScore, setHomeScore] = useState(
    match.home_score != null ? String(match.home_score) : '',
  )
  const [awayScore, setAwayScore] = useState(
    match.away_score != null ? String(match.away_score) : '',
  )
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (payload: {
      type: 'result' | 'forfeit' | 'revert'
      winnerTeamId?: string
      forfeitTeamId?: string
    }) => {
      if (payload.type === 'revert') {
        await revertMatchToScheduled(match.id)
        return
      }
      if (payload.type === 'forfeit' && payload.forfeitTeamId) {
        await recordForfeit(
          match.id,
          payload.forfeitTeamId,
          match.home_team_id,
          match.away_team_id,
        )
        return
      }
      if (payload.type === 'result' && payload.winnerTeamId) {
        await recordResult(match.id, {
          winnerTeamId: payload.winnerTeamId,
          homeScore: homeScore ? Number(homeScore) : undefined,
          awayScore: awayScore ? Number(awayScore) : undefined,
        })
      }
    },
    onSuccess: async (_data, payload) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['matches', selectedSeason?.id] }),
        queryClient.invalidateQueries({ queryKey: ['player-rankings'] }),
        queryClient.invalidateQueries({ queryKey: ['player-pool'] }),
        queryClient.invalidateQueries({ queryKey: ['player-profile'] }),
      ])
      setError(null)
      const winnerTeamId =
        payload.type === 'result'
          ? payload.winnerTeamId ?? null
          : payload.type === 'forfeit'
            ? payload.forfeitTeamId === match.home_team_id
              ? match.away_team_id
              : match.home_team_id
            : null
      if (winnerTeamId) {
        const winnerName =
          winnerTeamId === match.home_team_id
            ? match.home_team.name
            : match.away_team.name
        offerUndo({
          matchId: match.id,
          message: t('record.savedWinner', { name: winnerName }),
        })
      }
      onSaved?.({ type: payload.type, winnerTeamId })
      onDone?.()
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleWinner(winnerTeamId: string) {
    mutation.mutate({ type: 'result', winnerTeamId })
  }

  function handleForfeit(forfeitTeamId: string) {
    if (!confirm(t('record.confirmForfeit'))) return
    mutation.mutate({ type: 'forfeit', forfeitTeamId })
  }

  function handleRevert() {
    if (!confirm(t('record.confirmRevert'))) return
    mutation.mutate({ type: 'revert' })
  }

  return (
    <div
      className={
        compact
          ? 'mt-4 border-t border-green-100 pt-4'
          : 'mt-4 rounded-lg border border-dashed border-green-300 bg-green-50 p-3 sm:p-4'
      }
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-green-800">
          {editing ? t('record.editTitle') : t('record.title')}
        </p>
      </div>

      {editing && onDone && (
        <button
          type="button"
          onClick={onDone}
          className="mb-3 min-h-11 w-full rounded-lg border-2 border-amber-400 bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-200 active:bg-amber-300 sm:py-2"
        >
          {t('common.cancel')}
        </button>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="min-w-0">
          <span className="mb-1 block truncate text-xs font-semibold text-green-900">
            {match.home_team.name}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            placeholder={t('record.scorePlaceholder')}
            value={homeScore}
            onChange={(e) => setHomeScore(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block truncate text-xs font-semibold text-green-900">
            {match.away_team.name}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            placeholder={t('record.scorePlaceholder')}
            value={awayScore}
            onChange={(e) => setAwayScore(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => handleWinner(match.home_team_id)}
          className={btnPrimary}
        >
          {t('record.teamWins', { name: match.home_team.name })}
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => handleWinner(match.away_team_id)}
          className={btnPrimary}
        >
          {t('record.teamWins', { name: match.away_team.name })}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => handleForfeit(match.home_team_id)}
          className={btnSecondary}
        >
          {t('record.teamForfeit', { name: match.home_team.name })}
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => handleForfeit(match.away_team_id)}
          className={btnSecondary}
        >
          {t('record.teamForfeit', { name: match.away_team.name })}
        </button>
      </div>

      {editing && (
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={handleRevert}
          className={`${btnGhost} mt-2`}
        >
          {t('record.clearResult')}
        </button>
      )}

      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  )
}
