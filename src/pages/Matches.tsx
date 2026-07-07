import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MatchCard } from '../components/MatchCard'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { useMatches } from '../hooks/useMatches'
import { useTeams } from '../hooks/useTeams'
import type { MatchStatus } from '../types'

type StatusFilter = 'all' | MatchStatus

const STATUS_FILTERS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'filter.all' },
  { key: 'scheduled', labelKey: 'filter.uncompleted' },
  { key: 'completed', labelKey: 'filter.completed' },
  { key: 'forfeit', labelKey: 'filter.forfeit' },
]

export function MatchesPage() {
  const { t } = useTranslation()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [teamFilterId, setTeamFilterId] = useState<string>('all')
  const { data: matches, isError, error } = useMatches()
  const { data: teams } = useTeams()

  const filtered = useMemo(() => {
    return (matches ?? []).filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false

      if (teamFilterId !== 'all') {
        return m.home_team_id === teamFilterId || m.away_team_id === teamFilterId
      }

      return true
    })
  }, [matches, statusFilter, teamFilterId])

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <SetupBanner />
      <PageHeader
        title={t('matches.title')}
        subtitle={t('matches.subtitle', { count: matches?.length ?? 0 })}
      />

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-800">
          {t('matches.filterByTeam')}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setTeamFilterId('all')}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              teamFilterId === 'all'
                ? 'bg-green-600 text-white'
                : 'border border-green-200 bg-white text-green-800 hover:bg-green-50'
            }`}
          >
            {t('matches.allTeams')}
          </button>
          {(teams ?? []).map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setTeamFilterId(team.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                teamFilterId === team.id
                  ? 'bg-green-600 text-white'
                  : 'border border-green-200 bg-white text-green-800 hover:bg-green-50'
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: team.color }}
              />
              {team.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {STATUS_FILTERS.map(({ key, labelKey }) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={`min-h-11 rounded-full px-4 py-2.5 text-sm font-medium transition-colors sm:py-1.5 ${
              statusFilter === key
                ? 'bg-green-600 text-white'
                : 'border border-green-200 bg-white text-green-800 hover:bg-green-50 active:bg-green-100'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {filtered.length > 0 && (
        <p className="mb-4 text-sm text-gray-500">
          {t('matches.showing', { count: filtered.length })}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500">{t('matches.empty')}</p>
      ) : (
        <div className="space-y-4">
          {filtered.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      )}
    </div>
  )
}
