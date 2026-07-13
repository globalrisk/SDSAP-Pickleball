import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RecordResultForm } from './RecordResultForm'
import { useSeason } from '../context/SeasonContext'
import type { MatchWithTeams } from '../types'

interface MatchCardProps {
  match: MatchWithTeams
  showForm?: boolean
}

function StatusBadge({ status }: { status: MatchWithTeams['status'] }) {
  const { t } = useTranslation()
  const styles = {
    scheduled: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    forfeit: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {t(`status.${status}`)}
    </span>
  )
}

export function MatchCard({ match, showForm = true }: MatchCardProps) {
  const { t } = useTranslation()
  const { isSelectedSeasonActive } = useSeason()
  const [editing, setEditing] = useState(false)
  const isFinished = match.status === 'completed' || match.status === 'forfeit'
  const canEdit = showForm && isSelectedSeasonActive

  return (
    <div className="rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">
          {t('common.round')} {match.round_number}
        </span>
        <StatusBadge status={match.status} />
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TeamLabel team={match.home_team} />
        <div className="shrink-0 self-center text-center">
          {isFinished ? (
            <div>
              <p className="text-2xl font-bold text-gray-900 sm:text-xl">
                {match.home_score ?? '-'} : {match.away_score ?? '-'}
              </p>
              {match.winner && (
                <p className="mt-1 text-xs text-green-700">
                  {t('matches.teamWins', { name: match.winner.name })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm font-semibold text-gray-400">{t('common.vs')}</p>
          )}
        </div>
        <TeamLabel team={match.away_team} alignEnd />
      </div>

      {canEdit && match.status === 'scheduled' && <RecordResultForm match={match} />}

      {canEdit && isFinished && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-4 min-h-11 w-full rounded-lg border border-green-300 bg-white px-4 py-3 text-sm font-medium text-green-800 hover:bg-green-50 active:bg-green-100 sm:py-2"
        >
          {t('matches.editResult')}
        </button>
      )}

      {canEdit && isFinished && editing && (
        <RecordResultForm
          match={match}
          editing
          onDone={() => setEditing(false)}
        />
      )}
    </div>
  )
}

function TeamLabel({
  team,
  alignEnd = false,
}: {
  team: { name: string; color: string }
  alignEnd?: boolean
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 sm:flex-1 sm:bg-transparent sm:px-0 sm:py-0 ${
        alignEnd ? 'sm:justify-end' : ''
      }`}
    >
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: team.color }}
      />
      <span className="truncate font-semibold text-gray-900">{team.name}</span>
    </div>
  )
}
