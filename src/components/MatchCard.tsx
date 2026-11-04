import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { RecordResultForm } from './RecordResultForm'
import { TeamNameWithPlayers } from './TeamNameWithPlayers'
import { useSeason } from '../context/SeasonContext'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { formatMatchDate } from '../lib/formatDate'
import { calculateMatchProbability } from '../lib/matchProbability'
import type { MatchWithTeams } from '../types'

interface MatchCardProps {
  match: MatchWithTeams
  showForm?: boolean
  betting?: ReactNode
}

function StatusBadge({ status }: { status: MatchWithTeams['status'] }) {
  const { t } = useTranslation()
  const styles = {
    scheduled: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    forfeit: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {t(`status.${status}`)}
    </span>
  )
}

export function MatchCard({ match, showForm = true, betting }: MatchCardProps) {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  const { league } = useLeague()
  const { isSelectedSeasonActive } = useSeason()
  const [editing, setEditing] = useState(false)
  const isFinished = match.status === 'completed' || match.status === 'forfeit'
  const canEdit = isAdmin && league.status === 'active' && showForm && isSelectedSeasonActive
  const probability = match.status === 'scheduled'
    ? calculateMatchProbability(match.home_team, match.away_team)
    : null

  const recordedLabel = isFinished
    ? formatMatchDate(match.result_recorded_at, i18n.language)
    : null

  return (
    <div className="rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          {match.duel_sequence_number != null ? (
            <span className="min-w-0 text-xs font-semibold text-green-800 [overflow-wrap:anywhere]">
              {t('leagueDuel.gameLabel', { game: match.duel_sequence_number, round: match.round_number })}
            </span>
          ) : null}
          <div className="ml-auto shrink-0">
            <StatusBadge status={match.status} />
          </div>
        </div>
        {recordedLabel && (
          <p className="text-xs font-medium text-gray-500">{recordedLabel}</p>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:items-center sm:gap-3">
        <TeamLabel team={match.home_team} />
        <div className="shrink-0 self-center text-center">
          {isFinished ? (
            <div>
              <p className="text-2xl font-bold text-gray-900 sm:text-xl">
                {match.home_score ?? '-'} : {match.away_score ?? '-'}
              </p>
            </div>
          ) : (
            <p className="text-sm font-semibold text-gray-400">{t('common.vs')}</p>
          )}
        </div>
        <TeamLabel team={match.away_team} alignEnd />
      </div>
      {isFinished && match.winner && (
        <p className="mt-2 text-center text-xs text-green-700 [overflow-wrap:anywhere]">
          {t('matches.teamWins', { name: match.winner.name })}
        </p>
      )}

      {probability && (
        <WinProbability
          homeTeamName={match.home_team.name}
          awayTeamName={match.away_team.name}
          homeTeamColor={match.home_team.color}
          awayTeamColor={match.away_team.color}
          homeProbability={probability.home}
          homeRating={probability.homeRating}
          awayRating={probability.awayRating}
        />
      )}

      {betting}
      {match.status === 'cancelled' ? <p className="mt-4 text-sm text-gray-500">{t('record.cancelHelp')}</p> : null}
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
  homeTeamColor,
  awayTeamColor,
  homeProbability,
  homeRating,
  awayRating,
}: {
  homeTeamName: string
  awayTeamName: string
  homeTeamColor: string
  awayTeamColor: string
  homeProbability: number
  homeRating: number
  awayRating: number
}) {
  const { t } = useTranslation()
  const homePercent = Math.round(homeProbability * 100)
  const awayPercent = 100 - homePercent

  return (
    <div className="mt-4 border-t border-green-100 pt-3">
      <div className="mb-1.5 grid grid-cols-2 items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[1fr_auto_1fr] sm:gap-x-3">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-gray-900">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: homeTeamColor }} />
          {homePercent}% <span className="font-normal text-gray-500">({Math.round(homeRating)})</span>
        </span>
        <span className="col-span-2 row-start-1 text-center text-[11px] font-medium uppercase tracking-wide text-gray-400 sm:col-span-1 sm:col-start-2">
          {t('matches.winProbability')}
        </span>
        <span className="inline-flex min-w-0 items-center justify-end gap-1.5 text-right font-semibold text-gray-900">
          {awayPercent}% <span className="font-normal text-gray-500">({Math.round(awayRating)})</span>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: awayTeamColor }} />
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
          className="transition-[width]"
          style={{ width: `${homePercent}%`, backgroundColor: homeTeamColor }}
        />
        <div className="flex-1" style={{ backgroundColor: awayTeamColor }} />
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
        stackPlayers
      />
    </div>
  )
}
