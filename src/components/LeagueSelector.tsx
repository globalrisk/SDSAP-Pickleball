import { Select } from './Select'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'

export function LeagueSelector() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { leagues, league } = useLeague()

  if (leagues.length < 2) return null

  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 lg:flex-none">
      <span className="sr-only">{t('league.label')}</span>
      <Select
        value={league.slug}
        onValueChange={(value) => navigate(`/leagues/${value}`)}
        className="min-h-11 w-full min-w-0 truncate rounded-lg border border-green-200 bg-white px-2 py-1.5 text-xs font-semibold text-green-900 sm:text-sm lg:min-h-9 lg:w-auto lg:max-w-[12rem]"
        aria-label={t('league.label')}
      >
        {leagues.map((item) => (
          <option key={item.id} value={item.slug}>
            {item.name}{item.status === 'archived' ? ` (${t('league.archived')})` : ''}
          </option>
        ))}
      </Select>
    </label>
  )
}
