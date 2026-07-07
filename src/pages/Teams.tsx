import { useTranslation } from 'react-i18next'
import { TeamCard } from '../components/TeamCard'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { useTeamsWithPlayers } from '../hooks/useTeams'

export function TeamsPage() {
  const { t } = useTranslation()
  const { data: teams, isError, error } = useTeamsWithPlayers()

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <SetupBanner />
      <PageHeader title={t('teams.title')} subtitle={t('teams.subtitle')} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(teams ?? []).map((team) => (
          <TeamCard key={team.id} team={team} />
        ))}
      </div>
    </div>
  )
}
