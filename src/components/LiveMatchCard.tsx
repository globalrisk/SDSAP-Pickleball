import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { RecordResultForm, type SavedMatchResult } from './RecordResultForm'
import { TeamNameWithPlayers } from './TeamNameWithPlayers'
import type { MatchWithTeams } from '../types'

interface LiveMatchCardProps {
  match: MatchWithTeams
  label: string
  tone?: 'playing' | 'next' | 'available' | 'waiting'
  showResultForm?: boolean
  actions?: ReactNode
  onSaved?: (result: SavedMatchResult) => void
}

const toneClasses = {
  playing: 'border-red-300 ring-2 ring-red-100',
  next: 'border-amber-300 ring-1 ring-amber-100',
  available: 'border-green-200',
  waiting: 'border-gray-300 bg-gray-50',
}

export function LiveMatchCard({
  match,
  label,
  tone = 'available',
  showResultForm = false,
  actions,
  onSaved,
}: LiveMatchCardProps) {
  const { t } = useTranslation()

  return (
    <article className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${toneClasses[tone]}`}>
      <div className="flex items-center border-b border-gray-100 bg-gray-50/80 px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-green-800">
          {tone === 'playing' ? <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> : null}
          {label}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamNameWithPlayers
            name={match.home_team.name}
            color={match.home_team.color}
            players={match.home_team.players?.map((player) => ({
              name: player.name,
              poolPlayerId: player.pool_player_id,
            }))}
          />
          <span className="text-xs font-bold uppercase text-gray-400">{t('common.vs')}</span>
          <TeamNameWithPlayers
            name={match.away_team.name}
            color={match.away_team.color}
            players={match.away_team.players?.map((player) => ({
              name: player.name,
              poolPlayerId: player.pool_player_id,
            }))}
            alignEnd
          />
        </div>

        {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}

        {showResultForm ? (
          <>
            <p className="mt-4 text-center text-xs text-gray-500">{t('live.quickEntryHint')}</p>
            <RecordResultForm match={match} compact onSaved={onSaved} />
          </>
        ) : null}
      </div>
    </article>
  )
}
