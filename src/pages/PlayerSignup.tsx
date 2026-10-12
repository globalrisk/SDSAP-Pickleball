import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'

const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-green-200 px-3 py-2 text-base'

export function PlayerSignupPage() {
  const { t } = useTranslation()
  const { signUp, user, isLoading } = useAuth()
  const { leaguePath } = useLeague()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (isSubmitting) return
    setErrorKey(null)
    if (password !== confirmation) {
      setErrorKey('auth.passwordMismatch')
      return
    }
    setIsSubmitting(true)
    try {
      const signedIn = await signUp(email, password, new URL(leaguePath('/login'), window.location.origin).href)
      setPassword('')
      setConfirmation('')
      if (signedIn) navigate(leaguePath('/bets'), { replace: true })
      else setEmailSent(true)
    } catch (signupError) {
      const code = (signupError as { code?: string }).code
      const key = code === 'signup_disabled' ? 'auth.signupDisabled'
        : code === 'email_provider_disabled' ? 'auth.emailProviderDisabled'
        : code === 'email_address_not_authorized' ? 'auth.emailDeliveryUnavailable'
        : code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' ? 'auth.signupRateLimited'
        : code === 'weak_password' ? 'auth.weakPassword'
        : code === 'user_already_exists' || code === 'email_exists' ? 'auth.accountExists'
        : 'auth.signupFailed'
      setErrorKey(key)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) return <p role="status">{t('common.loading')}</p>

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-green-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-green-700">{t('auth.eyebrow')}</p>
      <h1 className="mt-1 text-2xl font-black text-green-950">{t(user ? 'auth.signedInTitle' : emailSent ? 'auth.checkEmail' : 'auth.signupTitle')}</h1>
      {user ? (
        <Link to={leaguePath('/bets')} className="mt-5 inline-flex min-h-11 items-center font-bold text-green-700 underline">{t('bets.title')}</Link>
      ) : emailSent ? (
        <p role="status" className="mt-4 text-sm text-gray-700">{t('auth.confirmEmailHelp')}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-gray-600">{t('auth.signupHelp')}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold text-gray-800">
              {t('auth.email')}
              <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm font-semibold text-gray-800">
              {t('auth.password')}
              <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} aria-describedby="signup-password-help" />
            </label>
            <p id="signup-password-help" className="text-xs text-gray-600">{t('auth.passwordHelp')}</p>
            <label className="block text-sm font-semibold text-gray-800">
              {t('auth.confirmPassword')}
              <input type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={inputClass} />
            </label>
            {errorKey ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{t(errorKey.startsWith('auth.') ? errorKey : 'auth.signupFailed')}</p> : null}
            <button type="submit" disabled={isSubmitting} className="min-h-11 w-full rounded-xl bg-green-600 px-5 py-2 font-bold text-white hover:bg-green-700 disabled:opacity-60">
              {t(isSubmitting ? 'auth.signingUp' : 'auth.signUp')}
            </button>
          </form>
        </>
      )}
      {!user ? <p className="mt-5 text-center text-sm text-gray-700">{t('auth.haveAccount')}{' '}<Link to={leaguePath('/login')} className="font-bold text-green-700 underline underline-offset-4">{t('auth.signIn')}</Link></p> : null}
    </section>
  )
}
