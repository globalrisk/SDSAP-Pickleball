import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'

export function AdminLoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { leaguePath } = useLeague()
  const { signIn, isAdmin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await signIn(email, password)
      navigate(leaguePath('/setup'), { replace: true })
    } catch (signInError) {
      setError((signInError as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isAdmin) {
    return (
      <section className="mx-auto max-w-md rounded-2xl border border-green-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold text-green-950">{t('auth.signedInTitle')}</h1>
        <button
          type="button"
          onClick={() => navigate(leaguePath('/setup'))}
          className="mt-5 min-h-11 rounded-xl bg-green-600 px-5 py-2 font-bold text-white hover:bg-green-700"
        >
          {t('auth.openAdmin')}
        </button>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-green-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-green-700">{t('auth.eyebrow')}</p>
      <h1 className="mt-1 text-2xl font-black text-green-950">{t('auth.title')}</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm font-semibold text-gray-800">
          {t('auth.email')}
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-green-200 px-3 py-2 text-base"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-800">
          {t('auth.password')}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-green-200 px-3 py-2 text-base"
          />
        </label>
        {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-11 w-full rounded-xl bg-green-600 px-5 py-2 font-bold text-white hover:bg-green-700 disabled:opacity-60"
        >
          {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </section>
  )
}
