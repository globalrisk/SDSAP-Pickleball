import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { LanguageSwitcher } from './LanguageSwitcher'
import { validatePasswordChange } from '../lib/playerAuth'
import { PlayerNameForm } from './PlayerNameForm'
import { useQuery } from '@tanstack/react-query'
import { fetchPlayerTitlesMap } from '../lib/api'
import { PlayerBadgeEditor } from './PlayerBadgeEditor'
import { PlayerTitleBadge } from './PlayerTitleBadge'

export function MyAccountSettings({ playerId, playerName, isLeagueMember = false }: { playerId?: string; playerName?: string; isLeagueMember?: boolean }) {
  const { t } = useTranslation()
  const { user, isAdmin, changePassword } = useAuth()
  const { league, leaguePath } = useLeague()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setSaved(false)
    setError(null)
    const invalid = validatePasswordChange(current, password, confirmation)
    if (invalid) {
      setError(t(invalid === 'currentRequired' ? 'me.currentPasswordRequired' : invalid === 'tooShort' ? 'auth.passwordHelp' : 'auth.passwordMismatch'))
      return
    }
    setPending(true)
    try {
      await changePassword(current, password)
      setCurrent(''); setPassword(''); setConfirmation(''); setSaved(true)
    } catch (failure) {
      const code = (failure as { code?: string }).code
      const key = code === 'invalid_credentials' || code === 'invalid_current_password' ? 'wrongCurrent'
        : code === 'weak_password' ? 'weakPassword' : code === 'same_password' ? 'samePassword'
        : code === 'reauthentication_needed' || code === 'session_not_found' || (failure as Error).message === 'PASSWORD_SESSION' ? 'sessionExpired'
        : code === 'over_request_rate_limit' ? 'rateLimited' : 'passwordError'
      setError(t(`me.${key}`))
    } finally { setPending(false) }
  }
  const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3 text-base focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-60'
  return <div className="grid items-start gap-5 md:grid-cols-2">
    <section className="rounded-xl border border-green-200 bg-white p-5">
      <h2 className="text-lg font-bold text-green-950">{t('me.tabs.settings')}</h2>
      <dl className="mt-4 space-y-4 text-sm">
        <div><dt className="text-gray-500">{t('adminAccount.email')}</dt><dd className="mt-1 break-all font-semibold text-green-950">{user?.email ?? '—'}</dd></div>
        <div><dt className="text-gray-500">{t('me.linkedPlayer')}</dt><dd className="mt-1 font-semibold text-green-950">{playerName ?? t('me.notLinked')}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-gray-600">{t('me.identityHelp')}</p>
      {playerId && playerName !== undefined ? <PlayerNameForm key={playerId} playerId={playerId} playerName={playerName} /> : null}
      {playerId && isLeagueMember ? <PlayerBadgeSettings key={`${league.id}:${playerId}`} playerId={playerId} /> : null}
      <div className="mt-5"><h3 className="mb-2 text-sm font-bold text-green-950">{t('language.label')}</h3><div className="inline-flex"><LanguageSwitcher /></div></div>
      {isAdmin ? <Link to={leaguePath('/account')} className="mt-5 inline-flex min-h-11 items-center font-semibold text-green-700 underline underline-offset-4">{t('me.adminUsername')}</Link> : null}
    </section>
    <section className="rounded-xl border border-green-200 bg-white p-5">
      <h2 className="text-lg font-bold text-green-950">{t('me.changePassword')}</h2>
      <form onSubmit={event => void save(event)} className="mt-4 space-y-4">
        <label className="block text-sm font-semibold text-green-950">{t('me.currentPassword')}<input type="password" required autoComplete="current-password" disabled={pending} value={current} onChange={event => { setCurrent(event.target.value); setSaved(false) }} className={inputClass} /></label>
        <label className="block text-sm font-semibold text-green-950">{t('me.newPassword')}<input type="password" required minLength={8} autoComplete="new-password" disabled={pending} value={password} onChange={event => { setPassword(event.target.value); setSaved(false) }} className={inputClass} aria-describedby="my-password-help" /></label>
        <p id="my-password-help" className="text-xs text-gray-600">{t('auth.passwordHelp')}</p>
        <label className="block text-sm font-semibold text-green-950">{t('auth.confirmPassword')}<input type="password" required minLength={8} autoComplete="new-password" disabled={pending} value={confirmation} onChange={event => { setConfirmation(event.target.value); setSaved(false) }} className={inputClass} /></label>
        <button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white hover:bg-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-50">{t(pending ? 'common.loading' : 'me.changePassword')}</button>
        {saved ? <p role="status" className="text-sm font-semibold text-green-700">{t('me.passwordSaved')}</p> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      </form>
    </section>
  </div>
}

function PlayerBadgeSettings({ playerId }: { playerId: string }) {
  const { t } = useTranslation()
  const { league } = useLeague()
  const badges = useQuery({
    queryKey: ['player-badges', league.id],
    queryFn: () => fetchPlayerTitlesMap(league.id),
  })
  const badge = badges.data?.get(playerId)
  return <div className="mt-5 border-t border-green-100 pt-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-green-950">{t('badges.label')}</h3>
      {badge ? <PlayerTitleBadge title={badge} /> : null}
    </div>
    {badges.isPending ? <p role="status" className="text-sm text-gray-600">{t('common.loading')}</p>
      : badges.isError ? <div><p role="alert" className="text-sm text-red-700">{t('badges.loadError')}</p><button type="button" onClick={() => void badges.refetch()} className="mt-2 min-h-11 text-sm font-semibold text-green-700 underline">{t('me.retry')}</button></div>
        : <PlayerBadgeEditor playerId={playerId} badge={badge?.label ?? ''} />}
  </div>
}
