import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GlobalLoadingOverlay } from './components/GlobalLoadingOverlay'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { LeagueSelector } from './components/LeagueSelector'
import { SeasonSelector } from './components/SeasonSelector'
import { useAuth } from './context/AuthContext'
import { useLeague } from './context/LeagueContext'

const navItems = [
  { to: '/', labelKey: 'nav.home', desktopKey: 'nav.dashboard', end: true },
  { to: '/live', labelKey: 'nav.live', desktopKey: 'nav.live' },
  { to: '/standings', labelKey: 'nav.standings', desktopKey: 'nav.standings' },
  { to: '/matches', labelKey: 'nav.matches', desktopKey: 'nav.matches' },
  { to: '/rankings', labelKey: 'nav.rankings', desktopKey: 'nav.rankings' },
  { to: '/match-planner', labelKey: 'nav.matchPlanner', desktopKey: 'nav.matchPlanner' },
  { to: '/team-duel', labelKey: 'nav.teamDuel', desktopKey: 'nav.teamDuel', global: true },
] as const

const manageItems = [
  { to: '/setup', labelKey: 'nav.setup' },
  { to: '/players', labelKey: 'nav.players' },
  { to: '/admin/leagues/new', labelKey: 'league.create' },
  { to: '/account', labelKey: 'nav.account' },
] as const

function navClassName(isActive: boolean, mobile = false) {
  const base = mobile
    ? 'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-2 text-xs font-medium transition-colors min-h-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-1'
    : 'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors min-h-10 inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-1'

  return isActive
    ? `${base} ${mobile ? 'bg-green-50 text-green-700' : 'bg-green-600 text-white'}`
    : `${base} ${mobile ? 'text-gray-500 active:bg-gray-50' : 'text-green-800 hover:bg-green-100'}`
}

export function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const { league, leaguePath } = useLeague()
  const { isAdmin, signOut } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [mobileManageOpen, setMobileManageOpen] = useState(false)
  const mobilePrimaryItems = navItems.slice(0, 4)
  const mobileMoreItems = navItems.slice(4)
  const itemPath = (item: (typeof navItems)[number]) =>
    'global' in item && item.global ? item.to : leaguePath(item.to)
  const manageActive = manageItems.some((item) => location.pathname.startsWith(leaguePath(item.to)))
  const moreActive = mobileMoreItems.some((item) => location.pathname.startsWith(itemPath(item))) || (isAdmin && manageActive)

  useEffect(() => {
    setMoreOpen(false)
    setManageOpen(false)
    setMobileManageOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.title = `${league.name} · Pickleball`
  }, [league.name])

  return (
    <div className="min-h-dvh bg-gradient-to-b from-green-50 to-green-100">
      <GlobalLoadingOverlay />
      <header
        className="sticky top-0 z-20 border-b border-green-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80"
        onKeyDown={(event) => { if (event.key === 'Escape') setManageOpen(false) }}
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex min-h-14 items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {league.logo_url ? (
                <img src={league.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green-700 text-sm font-black text-white" aria-hidden="true">
                  {league.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="truncate text-base font-bold text-green-800 sm:text-lg">{league.name}</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <LeagueSelector />
              <SeasonSelector />
              <LanguageSwitcher />
              {isAdmin ? (
                <button type="button" onClick={() => void signOut()} className="hidden min-h-9 rounded-lg border border-green-200 px-2 text-xs font-bold text-green-800 sm:inline-flex sm:items-center">
                  {t('auth.signOut')}
                </button>
              ) : (
                <NavLink to={leaguePath('/login')} className="hidden min-h-9 items-center rounded-lg border border-green-200 px-2 text-xs font-bold text-green-800 sm:inline-flex">
                  {t('auth.admin')}
                </NavLink>
              )}
            </div>
          </div>
          <nav className="hidden gap-1 overflow-x-auto pb-3 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={itemPath(item)}
                end={'end' in item ? item.end : undefined}
                className={({ isActive }) => navClassName(isActive)}
              >
                {t(item.desktopKey)}
              </NavLink>
            ))}
            {isAdmin ? (
              <button
                type="button"
                className={navClassName(manageActive || manageOpen)}
                aria-expanded={manageOpen}
                aria-controls="desktop-manage-menu"
                onClick={() => setManageOpen((open) => !open)}
              >
                {t('nav.manage')}
                <span aria-hidden="true" className="ml-1 text-xs">▾</span>
              </button>
            ) : null}
          </nav>
        </div>
        {isAdmin && manageOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-20 hidden cursor-default lg:block"
              aria-label={t('common.close')}
              onClick={() => setManageOpen(false)}
            />
            <div id="desktop-manage-menu" className="absolute right-4 top-full z-30 hidden w-64 rounded-b-2xl border border-green-200 bg-white p-2 shadow-xl lg:block">
              <ManageLinks onNavigate={() => setManageOpen(false)} />
            </div>
          </>
        ) : null}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 pb-24 sm:px-6 sm:py-6 lg:pb-6">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-green-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between gap-1">
          {mobilePrimaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={itemPath(item)}
              end={'end' in item ? item.end : undefined}
              className={({ isActive }) => navClassName(isActive, true)}
            >
              <NavIcon to={item.to} />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={navClassName(moreActive || moreOpen, true)}
            aria-expanded={moreOpen}
            aria-controls="mobile-more-menu"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreIcon />
            <span>{t('nav.more')}</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-20 bg-green-950/10 lg:hidden"
            aria-label={t('common.close')}
            onClick={() => setMoreOpen(false)}
          />
          <div
            id="mobile-more-menu"
            className="fixed inset-x-3 bottom-20 z-30 mx-auto max-h-[calc(100dvh-6rem)] max-w-sm overflow-y-auto rounded-2xl border border-green-200 bg-white p-2 shadow-xl lg:hidden"
          >
            {mobileMoreItems.map((item) => (
              <NavLink
                key={item.to}
                to={itemPath(item)}
                className={({ isActive }) =>
                  `flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
                    isActive
                      ? 'bg-green-600 text-white'
                      : 'text-green-900 hover:bg-green-50'
                  }`
                }
              >
                <NavIcon to={item.to} />
                {t(item.labelKey)}
              </NavLink>
            ))}
            {isAdmin ? (
              <>
                <div className="border-t border-green-100 pt-1">
                  <button
                    type="button"
                    className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold ${manageActive || mobileManageOpen ? 'bg-green-50 text-green-800' : 'text-green-900 hover:bg-green-50'}`}
                    aria-expanded={mobileManageOpen}
                    aria-controls="mobile-manage-menu"
                    onClick={() => setMobileManageOpen((open) => !open)}
                  >
                    <NavIcon to="/setup" />
                    <span className="flex-1">{t('nav.manage')}</span>
                    <span aria-hidden="true">{mobileManageOpen ? '▴' : '▾'}</span>
                  </button>
                  {mobileManageOpen ? (
                    <div id="mobile-manage-menu" className="border-l-2 border-green-100 pl-2">
                      <ManageLinks onNavigate={() => setMoreOpen(false)} />
                    </div>
                  ) : null}
                </div>
                <button type="button" onClick={() => void signOut()} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50">
                  <span aria-hidden="true">↪</span>{t('auth.signOut')}
                </button>
              </>
            ) : (
              <NavLink to={leaguePath('/login')} className="flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-green-900 hover:bg-green-50">
                <span aria-hidden="true">↳</span>{t('auth.admin')}
              </NavLink>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function ManageLinks({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation()
  const { leaguePath } = useLeague()

  return (
    <nav aria-label={t('nav.manage')} className="space-y-1">
      {manageItems.map((item) => (
        <NavLink
          key={item.to}
          to={leaguePath(item.to)}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
              isActive ? 'bg-green-600 text-white' : 'text-green-900 hover:bg-green-50'
            }`
          }
        >
          <NavIcon to={item.to} />
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  )
}

function MoreIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
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
    case '/live':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M5.05 13.343a9.828 9.828 0 0113.9 0M1.989 10.282a14.157 14.157 0 0120.022 0M12 20h.01" />
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
    case '/account':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="8" r="4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 21a8 8 0 0116 0" />
        </svg>
      )
    case '/setup':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    case '/match-planner':
      return (
        <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="8" y="2.5" width="8" height="4" rx="1.5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 4.5H6a2 2 0 00-2 2v13a2 2 0 002 2h12a2 2 0 002-2v-13a2 2 0 00-2-2h-2M11 11h5M11 16h5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 11h.01M7.5 16h.01" strokeWidth={3} />
        </svg>
      )
    case '/team-duel':
      return (
        <span
          aria-hidden="true"
          className={`${className} inline-flex items-center justify-center rounded-md border-2 border-current text-[8px] font-black leading-none tracking-tighter`}
        >
          VS
        </span>
      )
    case '/players':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 20H4a2 2 0 01-2-2v-1a5 5 0 015-5h4a5 5 0 015 5v1a2 2 0 01-2 2zM9 9a3 3 0 100-6 3 3 0 000 6zM20 8v6m-3-3h6" />
        </svg>
      )
    case '/admin/leagues/new':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
        </svg>
      )
    default:
      return null
  }
}
