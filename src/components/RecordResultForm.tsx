import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchMatchResultSnapshot,
  recordResult,
  revertMatchToScheduled,
} from '../lib/api'
import { useSeason } from '../context/SeasonContext'
import { useUndoResult } from '../context/undoResult'
import {
  decideMatchSaveRecovery,
  isLikelyConnectionError,
  type MatchResultSnapshot,
} from '../lib/matchSaveRecovery'
import {
  MatchResultValidationError,
  resultFromScores,
  type MatchResultValidationCode,
} from '../lib/matchResultValidation'
import type { MatchWithTeams } from '../types'

interface RecordResultFormProps {
  match: MatchWithTeams
  editing?: boolean
  onDone?: () => void
  compact?: boolean
  onSaved?: (result: SavedMatchResult) => void
}

export interface SavedMatchResult {
  type: 'result' | 'revert'
  winnerTeamId: string | null
}

type ResultMutationPayload = (
  | { type: 'result'; winnerTeamId: string; homeScore: number; awayScore: number }
  | { type: 'revert' }
) & {
  reconcile?: boolean
}

class MatchSaveConflictError extends Error {}

const btnPrimary =
  'min-h-11 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2'
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
  const { t, i18n } = useTranslation()
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
  const [validationCode, setValidationCode] = useState<MatchResultValidationCode | null>(null)
  const errorId = useId()
  const homeInput = useRef<HTMLInputElement>(null)
  const awayInput = useRef<HTMLInputElement>(null)
  const scoreInvalid = (score: string) => !Number.isInteger(Number(score)) || Number(score) < 0
  const homeInvalid = validationCode === 'scoresRequired' ? homeScore === ''
    : validationCode === 'scoresInvalid' ? scoreInvalid(homeScore)
    : validationCode === 'scoresTied'
  const awayInvalid = validationCode === 'scoresRequired' ? awayScore === ''
    : validationCode === 'scoresInvalid' ? scoreInvalid(awayScore)
    : validationCode === 'scoresTied'
  const [failedPayload, setFailedPayload] = useState<ResultMutationPayload | null>(
    null,
  )
  const expectedBeforeSave = useRef<MatchResultSnapshot>({
    status: match.status,
    winnerTeamId: match.winner_team_id,
    homeScore: match.home_score,
    awayScore: match.away_score,
  })

  function desiredSnapshot(payload: ResultMutationPayload): MatchResultSnapshot {
    if (payload.type === 'revert') {
      return {
        status: 'scheduled',
        winnerTeamId: null,
        homeScore: null,
        awayScore: null,
      }
    }
    return {
      status: 'completed',
      winnerTeamId: payload.winnerTeamId,
      homeScore: payload.homeScore,
      awayScore: payload.awayScore,
    }
  }

  const mutation = useMutation({
    mutationFn: async (payload: ResultMutationPayload) => {
      const desired = desiredSnapshot(payload)
      if (payload.reconcile) {
        const current = await fetchMatchResultSnapshot(match.id)
        const decision = decideMatchSaveRecovery(
          current,
          expectedBeforeSave.current,
          desired,
        )
        if (decision === 'already-saved') return
        if (decision === 'conflict') throw new MatchSaveConflictError()
      }

      if (payload.type === 'revert') {
        await revertMatchToScheduled(match.id)
        return
      }
      if (payload.type === 'result') {
        await recordResult(match.id, {
          winnerTeamId: payload.winnerTeamId,
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
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
      setValidationCode(null)
      setFailedPayload(null)
      const winnerTeamId = payload.type === 'result' ? payload.winnerTeamId : null
      if (winnerTeamId) {
        const winnerName =
          winnerTeamId === match.home_team_id
            ? match.home_team.name
            : match.away_team.name
        const savedAt = new Date().toLocaleTimeString(i18n.language, {
          hour: '2-digit',
          minute: '2-digit',
        })
        offerUndo({
          matchId: match.id,
          message: t('record.savedWinnerAt', { name: winnerName, time: savedAt }),
        })
      }
      onSaved?.({ type: payload.type, winnerTeamId })
      onDone?.()
    },
    onError: (err: Error, payload) => {
      if (err instanceof MatchSaveConflictError) {
        setFailedPayload(null)
        setError(t('record.saveConflict'))
        void queryClient
          .invalidateQueries({ queryKey: ['matches', selectedSeason?.id] })
          .then(() => onDone?.())
        return
      }
      if (isLikelyConnectionError(err)) {
        setFailedPayload({ ...payload, reconcile: undefined })
        setError(t('record.saveUnconfirmed'))
        return
      }
      setFailedPayload(null)
      setError(err instanceof MatchResultValidationError ? t(`record.validation.${err.code}`) : err.message)
    },
  })

  function submitPayload(payload: ResultMutationPayload, reconcile = false) {
    setError(null)
    if (!navigator.onLine) {
      setFailedPayload({ ...payload, reconcile: undefined })
      setError(t('record.offlineNotSaved'))
      return
    }
    mutation.mutate({ ...payload, reconcile })
  }

  function handleSave() {
    setValidationCode(null)
    if (homeScore === '' || awayScore === '') {
      setFailedPayload(null)
      setValidationCode('scoresRequired')
      setError(t('record.scoresRequired'))
      if (homeScore === '') homeInput.current?.focus()
      else awayInput.current?.focus()
      return
    }
    try {
      const result = resultFromScores(
        match.home_team_id,
        match.away_team_id,
        Number(homeScore),
        Number(awayScore),
      )
      submitPayload({ type: 'result', ...result }, failedPayload !== null)
    } catch (err) {
      setFailedPayload(null)
      if (err instanceof MatchResultValidationError) {
        setValidationCode(err.code)
        setError(t(`record.validation.${err.code}`))
        if (err.code === 'scoresInvalid' && !scoreInvalid(homeScore)) awayInput.current?.focus()
        else homeInput.current?.focus()
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
      return
    }
  }

  function handleRevert() {
    if (!confirm(t('record.confirmRevert'))) return
    submitPayload({ type: 'revert' }, failedPayload !== null)
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

      {mutation.isPending ? (
        <p
          className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800"
          role="status"
          aria-live="polite"
        >
          {t('record.saving')}
        </p>
      ) : null}

      {error ? (
        <div
          id={errorId}
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          role="alert"
        >
          <p>{validationCode ? t(`record.validation.${validationCode}`) : error}</p>
          {failedPayload ? (
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => submitPayload(failedPayload, true)}
              className="mt-2 min-h-10 rounded-lg bg-red-700 px-3 py-2 font-bold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {t('record.retrySave')}
            </button>
          ) : null}
        </div>
      ) : null}

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
            ref={homeInput}
            aria-invalid={homeInvalid}
            aria-describedby={homeInvalid ? errorId : undefined}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            required
            disabled={mutation.isPending}
            placeholder={t('record.scorePlaceholder')}
            value={homeScore}
            onChange={(e) => {
              setHomeScore(e.target.value)
              if (validationCode) { setValidationCode(null); setError(null) }
            }}
            className={`${inputClass} ${homeInvalid ? 'border-red-400 bg-red-50 ring-1 ring-red-400' : ''}`}
          />
        </label>
        <label className="min-w-0">
          <span className="mb-1 block truncate text-xs font-semibold text-green-900">
            {match.away_team.name}
          </span>
          <input
            ref={awayInput}
            aria-invalid={awayInvalid}
            aria-describedby={awayInvalid ? errorId : undefined}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            required
            disabled={mutation.isPending}
            placeholder={t('record.scorePlaceholder')}
            value={awayScore}
            onChange={(e) => {
              setAwayScore(e.target.value)
              if (validationCode) { setValidationCode(null); setError(null) }
            }}
            className={`${inputClass} ${awayInvalid ? 'border-red-400 bg-red-50 ring-1 ring-red-400' : ''}`}
          />
        </label>
      </div>

      <button
        type="button"
        disabled={mutation.isPending}
        onClick={handleSave}
        className={btnPrimary}
      >
        {t('record.saveResult')}
      </button>

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
    </div>
  )
}
