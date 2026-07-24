import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { SeasonRecapCard } from '../components/SeasonRecapCard'
import { useSeasonRecap } from '../hooks/useSeasonRecap'

export function SeasonRecapPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const { t } = useTranslation()
  const { data: recap, isError, error, isLoading } = useSeasonRecap(seasonId)

  if (isError) return <ErrorState message={(error as Error).message} />

  if (isLoading || !recap) {
    return (
      <div>
        <SetupBanner />
        <PageHeader title={t('recap.title')} />
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div>
      <SetupBanner />
      <div className="mb-4">
        <Link to="/" className="text-sm text-green-700 hover:underline">
          ← {t('recap.backHome')}
        </Link>
      </div>
      <PageHeader
        title={t('recap.title')}
        subtitle={t('recap.subtitle', { season: recap.seasonName })}
      />

      <SeasonRecapCard recap={recap} />
    </div>
  )
}
