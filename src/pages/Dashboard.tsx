import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { DashboardHighlights } from '../components/DashboardHighlights'
import { MatchCard } from '../components/MatchCard'
import { ArchivedSeasonBanner } from '../components/ArchivedSeasonBanner'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { StandingsTable } from '../components/StandingsTable'
import { useSeason } from '../context/SeasonContext'
import { useMatches } from '../hooks/useMatches'
import { useStandings } from '../hooks/useStandings'
import { useTeamsWithPlayers } from '../hooks/useTeams'
import { computeLeagueHighlights } from '../lib/engagement'

export function Dashboard() {
  const { t } = useTranslation()
  const { selectedSeason, isSelectedSeasonActive } = useSeason()
  const { standings, isError, error } = useStandings()
  const { data: matches } = useMatches()
  const { data: teams } = useTeamsWithPlayers()

  const highlights = useMemo(
    () => computeLeagueHighlights(matches ?? []),
    [matches],
  )

  if (isError) return <ErrorState message={(error as Error).message} />

  const upcoming = (matches ?? [])
    .filter((m) => m.status === 'scheduled')
    .slice(0, 3)

  const recent = (matches ?? [])
    .filter((m) => m.status === 'completed' || m.status === 'forfeit')
    .slice(0, 3)

  return (
    <div>
      <SetupBanner />
      <ArchivedSeasonBanner />
      <PageHeader
        title={selectedSeason?.name ?? t('dashboard.title')}
        subtitle={t('dashboard.subtitleDynamic', {
          teams: teams?.length ?? 0,
          players: (teams ?? []).reduce((sum, team) => sum + team.players.length, 0),
        })}
        action={
          isSelectedSeasonActive
            ? { label: t('dashboard.recordResult'), to: '/matches' }
            : undefined
        }
      />

      <DashboardHighlights highlights={highlights} />

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-green-900">
            {t('dashboard.standings')}
          </h2>
          <Link to="/standings" className="text-sm text-green-700 hover:underline">
            {t('common.viewAll')}
          </Link>
        </div>
        <StandingsTable rows={standings} compact />
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-green-900">
            {t('dashboard.upcomingMatches')}
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-500">{t('dashboard.noUpcoming')}</p>
          ) : (
            <div className="space-y-4">
              {upcoming.map((match) => (
                <MatchCard key={match.id} match={match} showForm={false} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-green-900">
            {t('dashboard.recentResults')}
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-500">{t('dashboard.noResults')}</p>
          ) : (
            <div className="space-y-4">
              {recent.map((match) => (
                <MatchCard key={match.id} match={match} showForm={false} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
