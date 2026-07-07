import { useTranslation } from 'react-i18next'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { StandingsTable } from '../components/StandingsTable'
import { useStandings } from '../hooks/useStandings'

export function StandingsPage() {
  const { t } = useTranslation()
  const { standings, isError, error } = useStandings()

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <SetupBanner />
      <PageHeader
        title={t('standings.leagueTitle')}
        subtitle={t('standings.subtitle')}
      />
      <StandingsTable rows={standings} />
    </div>
  )
}
