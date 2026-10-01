import { useTranslation } from 'react-i18next'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { ArchivedSeasonBanner } from '../components/ArchivedSeasonBanner'
import { StandingsTable } from '../components/StandingsTable'
import { useStandings } from '../hooks/useStandings'
import { LeagueTeamDuelScoreboard } from '../components/LeagueTeamDuelScoreboard'
import { useSeason } from '../context/SeasonContext'

export function StandingsPage() {
  const { t } = useTranslation()
  const { standings, isError, error } = useStandings()
  const { selectedSeason } = useSeason()

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <SetupBanner />
      <ArchivedSeasonBanner />
      <PageHeader
        title={t('standings.leagueTitle')}
        subtitle={t(selectedSeason?.format === 'team_duel' ? 'leagueDuel.standingsHelp' : 'standings.subtitle')}
      />
      <LeagueTeamDuelScoreboard />
      <StandingsTable rows={standings} />
    </div>
  )
}
