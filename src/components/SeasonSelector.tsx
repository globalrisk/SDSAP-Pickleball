import { useTranslation } from 'react-i18next'
import { useSeason } from '../context/SeasonContext'

export function SeasonSelector() {
  const { t } = useTranslation()
  const { seasons, selectedSeason, setSelectedSeasonId, isLoading } = useSeason()

  if (isLoading || seasons.length === 0) return null

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{t('season.label')}</span>
      <select
        value={selectedSeason?.id ?? ''}
        onChange={(e) => setSelectedSeasonId(e.target.value)}
        className="min-h-9 max-w-[9rem] truncate rounded-lg border border-green-200 bg-white px-2 py-1.5 text-xs font-medium text-green-800 sm:max-w-[11rem] sm:text-sm"
        aria-label={t('season.label')}
      >
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
            {season.status === 'archived' ? ` (${t('season.archived')})` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
