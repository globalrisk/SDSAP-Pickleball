import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GlobalLoadingOverlay } from './components/GlobalLoadingOverlay'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { SeasonSelector } from './components/SeasonSelector'

const navItems = [
  { to: '/', labelKey: 'nav.home', desktopKey: 'nav.dashboard', end: true },
  { to: '/standings', labelKey: 'nav.standings', desktopKey: 'nav.standings' },
  { to: '/matches', labelKey: 'nav.matches', desktopKey: 'nav.matches' },
  { to: '/rankings', labelKey: 'nav.rankings', desktopKey: 'nav.rankings' },
  { to: '/setup', labelKey: 'nav.setup', desktopKey: 'nav.setup' },
] as const

function navClassName(isActive: boolean, mobile = false) {
  const base = mobile
    ? 'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors min-h-11'
    : 'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-10 inline-flex items-center'

  return isActive
    ? `${base} ${mobile ? 'bg-green-50 text-green-700' : 'bg-green-600 text-white'}`
    : `${base} ${mobile ? 'text-gray-500 active:bg-gray-50' : 'text-green-800 hover:bg-green-100'}`
}

export function AppLayout() {
  const { t } = useTranslation()

  return (
    <div className="min-h-dvh bg-gradient-to-b from-green-50 to-green-100">
      <GlobalLoadingOverlay />
      <header className="sticky top-0 z-20 border-b border-green-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex h-12 items-center justify-between gap-3 sm:h-14">
            <span className="text-base font-bold text-green-800 sm:text-lg">
              {t('app.title')}
            </span>
            <div className="flex items-center gap-2">
              <SeasonSelector />
              <LanguageSwitcher />
            </div>
          </div>
          <nav className="hidden gap-1 overflow-x-auto pb-3 md:flex">
            {navItems.map(({ to, labelKey, desktopKey, ...rest }) => (
              <NavLink
                key={to}
                to={to}
                end={'end' in rest ? rest.end : undefined}
                className={({ isActive }) => navClassName(isActive)}
              >
                {t(desktopKey ?? labelKey)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 pb-24 sm:px-6 sm:py-6 md:pb-6">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-green-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between gap-1">
          {navItems.map(({ to, labelKey, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest ? rest.end : undefined}
              className={({ isActive }) => navClassName(isActive, true)}
            >
              <NavIcon to={to} />
              <span>{t(labelKey)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

function NavIcon({ to }: { to: string }) {
  const className = 'h-5 w-5'
  switch (to) {
    case '/':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    case '/standings':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    case '/matches':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )
    case '/rankings':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      )
    case '/setup':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    default:
      return null
  }
}
