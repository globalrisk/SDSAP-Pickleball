import { Select } from './Select'
import { useTranslation } from 'react-i18next'
import { useSeason } from '../context/SeasonContext'

export function SeasonSelector() {
  const { t } = useTranslation()
  const { seasons, selectedSeason, setSelectedSeasonId, isLoading } = useSeason()

  if (isLoading || seasons.length === 0) return null

  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
      <span className="sr-only">{t('season.label')}</span>
      <Select
        value={selectedSeason?.id ?? ''}
        onValueChange={(value) => setSelectedSeasonId(value)}
        className="min-h-11 w-full min-w-0 truncate rounded-lg border border-green-200 bg-white px-2 py-1.5 text-xs font-medium text-green-800 sm:text-sm lg:min-h-9 lg:w-auto lg:max-w-[11rem]"
        aria-label={t('season.label')}
      >
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
            {season.status === 'archived' ? ` (${t('season.archived')})` : ''}
          </option>
        ))}
      </Select>
    </label>
  )
}
