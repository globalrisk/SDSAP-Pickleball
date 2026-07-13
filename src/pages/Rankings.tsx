import { useTranslation } from 'react-i18next'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { PlayerRankingsTable } from '../components/PlayerRankingsTable'
import { usePlayerRankings } from '../hooks/usePlayerRankings'

export function RankingsPage() {
  const { t } = useTranslation()
  const { data: rankings, isError, error, isLoading } = usePlayerRankings()

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <SetupBanner />
      <PageHeader title={t('rankings.title')} subtitle={t('rankings.subtitle')} />

      {isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <PlayerRankingsTable rows={rankings ?? []} />
      )}
    </div>
  )
}
