import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createSeasonMatches } from '../lib/api'
import { MatchCard } from '../components/MatchCard'
import { LeagueTeamDuelScoreboard } from '../components/LeagueTeamDuelScoreboard'
import { ArchivedSeasonBanner } from '../components/ArchivedSeasonBanner'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { useSeason } from '../context/SeasonContext'
import { useMatches } from '../hooks/useMatches'
import { useTeams } from '../hooks/useTeams'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
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
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()
  const { league } = useLeague()
  const { selectedSeason, isSelectedSeasonActive } = useSeason()
  const isDuel = selectedSeason?.format === 'team_duel'
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [teamFilterId, setTeamFilterId] = useState<string>('all')
  const [message, setMessage] = useState<string | null>(null)
  const { data: matches, isError, error, isLoading } = useMatches()
  const { data: teams } = useTeams()

  const matchCount = matches?.length ?? 0
  const hasForfeits = matches?.some((match) => match.status === 'forfeit') ?? false
  const activeStatusFilter = statusFilter === 'forfeit' && !hasForfeits ? 'all' : statusFilter
  const statusFilters = STATUS_FILTERS.filter(({ key }) => key !== 'forfeit' || hasForfeits)
  const teamCount = teams?.length ?? 0
  const canCreateMatches =
    isAdmin &&
    league.status === 'active' &&
    isSelectedSeasonActive &&
    matchCount === 0 &&
    teamCount >= 2

  const createMatchesMutation = useMutation({
    mutationFn: () => createSeasonMatches(selectedSeason!.id),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['matches', selectedSeason?.id] })
      setMessage(t('matches.createSuccess', { count }))
    },
    onError: (err: Error) => setMessage(t('matches.createFailed', { message: err.message })),
  })

  function handleCreateMatches() {
    if (!selectedSeason || !canCreateMatches) return
    if (!confirm(t(isDuel ? 'leagueDuel.generateConfirm' : 'matches.createConfirm', { teams: teamCount }))) return
    createMatchesMutation.mutate()
  }

  const filtered = useMemo(() => {
    return (matches ?? []).filter((m) => {
      if (activeStatusFilter !== 'all' && m.status !== activeStatusFilter) return false

      if (teamFilterId !== 'all') {
        return m.home_team_id === teamFilterId || m.away_team_id === teamFilterId
      }

      return true
    })
  }, [matches, activeStatusFilter, teamFilterId])

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <SetupBanner />
      <ArchivedSeasonBanner />
      <PageHeader
        title={t('matches.title')}
        subtitle={t('matches.subtitle', { count: matchCount })}
      />

      <LeagueTeamDuelScoreboard />

      {isAdmin && league.status === 'active' && isSelectedSeasonActive && !isLoading && matchCount === 0 && (
        <section className="mb-6 rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-green-900">
                {t('matches.createTitle')}
              </h2>
              <p className="mt-1 text-sm text-gray-600">{t(isDuel ? 'leagueDuel.generateDescription' : 'matches.createDescription')}</p>
              {matchCount === 0 && teamCount < 2 && (
                <p className="mt-1 text-sm text-amber-700">{t('matches.createNeedTeams')}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleCreateMatches}
              disabled={!canCreateMatches || createMatchesMutation.isPending}
              className="min-h-11 shrink-0 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2"
            >
              {createMatchesMutation.isPending
                ? t('matches.creating')
                : t('matches.createButton')}
            </button>
          </div>
          {message && (
            <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>
          )}
        </section>
      )}

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-800">
          {t('matches.filterByTeam')}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            aria-pressed={teamFilterId === 'all'}
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
              aria-pressed={teamFilterId === team.id}
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

      <div className={`mb-6 grid gap-2 sm:flex sm:flex-wrap ${hasForfeits ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {statusFilters.map(({ key, labelKey }) => (
          <button
            key={key}
            type="button"
            aria-pressed={activeStatusFilter === key}
            onClick={() => setStatusFilter(key)}
            className={`min-h-11 rounded-full px-4 py-2.5 text-sm font-medium transition-colors sm:py-1.5 ${
              activeStatusFilter === key
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
