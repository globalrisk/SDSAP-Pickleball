import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'

export function LeagueSelector() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { leagues, league } = useLeague()

  if (leagues.length < 2) return null

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{t('league.label')}</span>
      <select
        value={league.slug}
        onChange={(event) => navigate(`/leagues/${event.target.value}`)}
        className="min-h-9 max-w-[9rem] truncate rounded-lg border border-green-200 bg-white px-2 py-1.5 text-xs font-semibold text-green-900 sm:max-w-[12rem] sm:text-sm"
        aria-label={t('league.label')}
      >
        {leagues.map((item) => (
          <option key={item.id} value={item.slug}>
            {item.name}{item.status === 'archived' ? ` (${t('league.archived')})` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
