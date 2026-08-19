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
import { usePlayerPool } from '../hooks/usePlayerPool'
import { computeLeagueHighlights } from '../lib/engagement'

export function Dashboard() {
  const { t } = useTranslation()
  const { selectedSeason, isSelectedSeasonActive } = useSeason()
  const { standings, isError, error } = useStandings()
  const { data: matches } = useMatches()
  const { data: teams } = useTeamsWithPlayers()
  const { data: playerPool } = usePlayerPool()

  const highlights = useMemo(
    () => computeLeagueHighlights(matches ?? []),
    [matches],
  )

  if (isError) return <ErrorState message={(error as Error).message} />

  const allMatches = matches ?? []
  const teamCount = teams?.length ?? 0
  const assignedPlayerCount = (teams ?? []).reduce(
    (sum, team) => sum + team.players.length,
    0,
  )
  const poolPlayerCount = playerPool?.filter((player) => player.status === 'active').length ?? 0
  const setupIncomplete = isSelectedSeasonActive && (teamCount < 2 || allMatches.length === 0)
  const upcoming = allMatches.filter((m) => m.status === 'scheduled').slice(0, 3)

  const recent = allMatches
    .filter((m) => m.status === 'completed' || m.status === 'forfeit')
    .slice(0, 3)

  const seasonComplete =
    allMatches.length > 0 &&
    allMatches.every((m) => m.status === 'completed' || m.status === 'forfeit')
  const showRecap =
    Boolean(selectedSeason) && (!isSelectedSeasonActive || seasonComplete)

  return (
    <div>
      <SetupBanner />
      <ArchivedSeasonBanner />
      <PageHeader
        title={selectedSeason?.name ?? t('dashboard.title')}
        subtitle={t('dashboard.subtitleDynamic', {
          teams: teamCount,
          players: assignedPlayerCount,
        })}
        action={
          isSelectedSeasonActive
            ? { label: t('dashboard.liveMode'), to: '/live' }
            : undefined
        }
      />

      {setupIncomplete ? (
        <section className="mb-8 overflow-hidden rounded-2xl border border-green-300 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-green-800 to-emerald-600 px-5 py-5 text-white sm:px-6">
            <p className="text-xs font-bold uppercase tracking-wider text-green-100">
              {t('dashboard.getStartedEyebrow')}
            </p>
            <h2 className="mt-1 text-xl font-bold">{t('dashboard.getStartedTitle')}</h2>
            <p className="mt-1 text-sm text-green-50">{t('dashboard.getStartedDescription')}</p>
          </div>
          <ol className="grid gap-0 sm:grid-cols-3">
            <SetupStep
              number={1}
              done={poolPlayerCount >= 2}
              title={t('dashboard.stepPlayers')}
              detail={t('dashboard.stepPlayersDetail')}
              to="/setup?section=players"
            />
            <SetupStep
              number={2}
              done={teamCount >= 2}
              title={t('dashboard.stepTeams')}
              detail={t('dashboard.stepTeamsDetail')}
              to="/setup?section=teams"
            />
            <SetupStep
              number={3}
              done={allMatches.length > 0}
              title={t('dashboard.stepSchedule')}
              detail={t('dashboard.stepScheduleDetail')}
              to="/matches"
            />
          </ol>
        </section>
      ) : null}

      {showRecap && selectedSeason ? (
        <div className="mb-6 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p className="font-semibold">{t('recap.dashboardTitle')}</p>
          <p className="mt-1">{t('recap.dashboardMessage')}</p>
          <Link
            to={`/seasons/${selectedSeason.id}/recap`}
            className="mt-2 inline-flex font-semibold text-green-800 underline-offset-2 hover:underline"
          >
            {t('recap.dashboardLink')}
          </Link>
        </div>
      ) : null}

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

function SetupStep({
  number,
  done,
  title,
  detail,
  to,
}: {
  number: number
  done: boolean
  title: string
  detail: string
  to: string
}) {
  const { t } = useTranslation()

  return (
    <li className="border-b border-green-100 p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? 'bg-green-600 text-white' : 'bg-green-100 text-green-800'
          }`}
          aria-hidden="true"
        >
          {done ? '✓' : number}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-green-950">{title}</p>
          <p className="mt-0.5 text-sm text-gray-600">{detail}</p>
          {done ? (
            <span className="mt-2 inline-flex text-xs font-bold text-green-700">
              {t('dashboard.stepDone')}
            </span>
          ) : (
            <Link
              to={to}
              className="mt-2 inline-flex min-h-10 items-center rounded-lg font-bold text-green-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
            >
              {t('dashboard.stepAction')} →
            </Link>
          )}
        </div>
      </div>
    </li>
  )
}
