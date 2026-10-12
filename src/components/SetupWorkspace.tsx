import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { leagueSetupSections, seasonSetupSections, type SetupSection } from '../lib/setupWorkspace'
import type { Season } from '../types'

export function SetupSectionIcon({ section }: { section: SetupSection }) {
  const paths: Record<SetupSection, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    roster: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5" /></>,
    teams: <><path d="m4 3 17 17M20 3 3 20M3 3h5M3 3v5M21 3h-5M21 3v5M3 16v5h5M16 21h5v-5" /></>,
    prizes: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z" /></>,
    finish: <><path d="M5 21V3M5 4h14l-3 5 3 5H5" /></>,
    members: <><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="9" r="2" /><path d="M8 17a4 4 0 0 1 8 0" /></>,
    accounts: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-8 2 2 4-4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" /><circle cx="12" cy="12" r="7" /></>,
  }
  return <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[section]}</svg>
}

export function SetupWorkspace({ section, onSectionChange, season, leagueName, children, archivedLeague = false }: {
  section: SetupSection
  onSectionChange: (section: SetupSection) => void
  season: Season | null
  leagueName: string
  children: ReactNode
  archivedLeague?: boolean
}) {
  const { t } = useTranslation()
  const seasonSections = archivedLeague ? season?.format === 'team_duel' ? ['prizes'] as const : [] : seasonSetupSections
  const leagueSections = archivedLeague ? ['settings'] as const : leagueSetupSections
  return <div className="overflow-clip rounded-xl border border-green-200 bg-white md:grid md:grid-cols-[12rem_minmax(0,1fr)] lg:grid-cols-[13rem_minmax(0,1fr)]">
    <div className="border-b border-green-100 bg-green-50/30 p-4 md:hidden">
      <label htmlFor="setup-section" className="mb-1.5 block text-xs font-semibold text-green-800">{t('setup.title')}</label>
      <select id="setup-section" value={section} onChange={event => onSectionChange(event.target.value as SetupSection)} className="min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base font-semibold text-green-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
        <optgroup label={season?.name ?? t('workspace.seasonGroup')}>
          {seasonSections.map(item => <option key={item} value={item}>{t('workspace.mobileSeasonSection', { section: t(`workspace.sections.${item}`) })}</option>)}
        </optgroup>
        <optgroup label={t('workspace.leagueGroup')}>
          {leagueSections.map(item => <option key={item} value={item}>{t(`workspace.sections.${item}`)}</option>)}
        </optgroup>
      </select>
    </div>
    <aside className="hidden border-r border-green-100 bg-green-50/20 p-3 md:block">
      <nav aria-label={t('setup.sectionsLabel')} className="sticky top-36 space-y-6 lg:top-32">
        {[{ scope: 'season', label: season?.name ?? t('workspace.seasonGroup'), items: seasonSections }, { scope: 'league', label: t('workspace.leagueGroup'), items: leagueSections }].filter(group => group.items.length > 0).map(group => <div key={group.scope}>
          <p className="mb-2 break-words px-3 text-xs font-semibold uppercase tracking-wide text-green-700">{group.label}</p>
          <ul className="space-y-1">{group.items.map(item => <li key={item}>
            <button type="button" aria-current={section === item ? 'page' : undefined} onClick={() => onSectionChange(item)} className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${section === item ? 'bg-green-100 text-green-900' : 'text-green-800 hover:bg-green-50'}`}>
              <SetupSectionIcon section={item} /><span className="min-w-0 break-words">{t(`workspace.sections.${item}`)}</span>
            </button>
          </li>)}</ul>
        </div>)}
      </nav>
    </aside>
    <div className="min-w-0 bg-green-50/20 p-4 sm:p-5 lg:p-7">
      <p className="mb-3 break-words text-xs text-green-700">{leagueName} / {seasonSetupSections.includes(section as (typeof seasonSetupSections)[number]) ? season?.name ?? t('workspace.seasonGroup') : t('workspace.leagueGroup')}</p>
      {children}
    </div>
  </div>
}
