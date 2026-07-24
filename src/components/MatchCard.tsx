import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RecordResultForm } from './RecordResultForm'
import { TeamNameWithPlayers } from './TeamNameWithPlayers'
import { useSeason } from '../context/SeasonContext'
import { formatMatchDate } from '../lib/formatDate'
import { calculateMatchProbability } from '../lib/matchProbability'
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
  const { t, i18n } = useTranslation()
  const { isSelectedSeasonActive } = useSeason()
  const [editing, setEditing] = useState(false)
  const isFinished = match.status === 'completed' || match.status === 'forfeit'
  const canEdit = showForm && isSelectedSeasonActive
  const probability = !isFinished
    ? calculateMatchProbability(match.home_team, match.away_team)
    : null

  const recordedLabel = isFinished
    ? formatMatchDate(match.result_recorded_at, i18n.language)
    : null

  return (
    <div className="rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">
          {recordedLabel ?? '\u00a0'}
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

      {probability && (
        <WinProbability
          homeTeamName={match.home_team.name}
          awayTeamName={match.away_team.name}
          homeProbability={probability.home}
          homeRating={probability.homeRating}
          awayRating={probability.awayRating}
        />
      )}

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

function WinProbability({
  homeTeamName,
  awayTeamName,
  homeProbability,
  homeRating,
  awayRating,
}: {
  homeTeamName: string
  awayTeamName: string
  homeProbability: number
  homeRating: number
  awayRating: number
}) {
  const { t } = useTranslation()
  const homePercent = Math.round(homeProbability * 100)
  const awayPercent = 100 - homePercent

  return (
    <div className="mt-4 border-t border-green-100 pt-3">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-semibold text-green-800">
          {homePercent}% <span className="font-normal text-gray-500">({Math.round(homeRating)})</span>
        </span>
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          {t('matches.winProbability')}
        </span>
        <span className="min-w-0 truncate text-right font-semibold text-green-800">
          {awayPercent}% <span className="font-normal text-gray-500">({Math.round(awayRating)})</span>
        </span>
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-green-100"
        role="img"
        aria-label={t('matches.probabilityLabel', {
          homeTeam: homeTeamName,
          homePercent,
          awayTeam: awayTeamName,
          awayPercent,
        })}
      >
        <div
          className="bg-green-600 transition-[width]"
          style={{ width: `${homePercent}%` }}
        />
        <div className="flex-1 bg-emerald-300" />
      </div>
      <p className="mt-1 text-center text-[10px] text-gray-400">
        {t('matches.averageRating')}
      </p>
    </div>
  )
}

function TeamLabel({
  team,
  alignEnd = false,
}: {
  team: {
    name: string
    color: string
    players?: { name: string; pool_player_id?: string; rating?: number }[]
  }
  alignEnd?: boolean
}) {
  return (
    <div
      className={`min-w-0 rounded-lg bg-green-50 px-3 py-2.5 sm:flex-1 sm:bg-transparent sm:px-0 sm:py-0 ${
        alignEnd ? 'sm:text-right' : ''
      }`}
    >
      <TeamNameWithPlayers
        name={team.name}
        color={team.color}
        players={(team.players ?? []).map((player) => ({
          name: player.name,
          poolPlayerId: player.pool_player_id,
        }))}
        alignEnd={alignEnd}
      />
    </div>
  )
}
