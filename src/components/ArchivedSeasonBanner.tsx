import { useTranslation } from 'react-i18next'
import { useSeason } from '../context/SeasonContext'

export function ArchivedSeasonBanner() {
  const { t } = useTranslation()
  const { selectedSeason, isSelectedSeasonActive } = useSeason()

  if (!selectedSeason || isSelectedSeasonActive) return null

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">{t('season.archivedBannerTitle')}</p>
      <p className="mt-1">{t('season.archivedBannerMessage', { name: selectedSeason.name })}</p>
    </div>
  )
}
