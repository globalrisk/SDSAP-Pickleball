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

      <p className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        {t('rankings.methodNote')}
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <PlayerRankingsTable rows={rankings ?? []} />
      )}
    </div>
  )
}
