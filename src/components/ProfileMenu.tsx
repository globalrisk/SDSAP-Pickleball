import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { useMyPlayerAccount } from '../hooks/useBets'
import { PROFILE_TABS } from '../lib/myProfile'

export function ProfileMenu() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const { leaguePath } = useLeague()
  const account = useMyPlayerAccount()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { setOpen(false) }, [location.key])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  async function logout() {
    setPending(true)
    setFailed(false)
    try { await signOut() } catch { setFailed(true) } finally { setPending(false) }
  }
  if (!user) return null
  const name = account.data?.name ?? t('me.title')
  return <div ref={root} className="relative hidden sm:block" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
  }}>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls="profile-menu" onClick={() => setOpen(value => !value)} className="inline-flex min-h-11 max-w-48 items-center gap-2 rounded-lg border border-green-200 px-3 text-sm font-bold text-green-900 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
      <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs">{name.slice(0, 1).toUpperCase()}</span>
      <span className="truncate">{t('me.title')}</span><span aria-hidden="true">⌄</span>
    </button>
    {open ? <nav id="profile-menu" aria-label={t('me.menu')} className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-green-200 bg-white p-2 shadow-lg">
      <p className="truncate border-b border-green-100 px-3 py-2 text-sm font-bold text-green-950">{name}</p>
      {PROFILE_TABS.filter(tab => tab !== 'settings').map(tab => <Link key={tab} to={leaguePath(`/me?tab=${tab}`)} className="flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-green-900 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">{t(`me.menuItems.${tab}`)}</Link>)}
      <button type="button" disabled={pending} onClick={() => void logout()} className="mt-1 flex min-h-11 w-full items-center rounded-lg border-t border-green-100 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-50">{t('auth.signOut')}</button>
      {failed ? <p role="alert" className="p-3 text-sm text-red-700">{t('me.signOutError')}</p> : null}
    </nav> : null}
  </div>
}
