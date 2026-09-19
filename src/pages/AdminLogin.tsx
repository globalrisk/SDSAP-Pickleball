import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AdminLoginForm } from '../components/AdminLoginForm'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'

export function AdminLoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { leaguePath } = useLeague()
  const { isAdmin } = useAuth()

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

  return <AdminLoginForm onSuccess={() => navigate(leaguePath('/setup'), { replace: true })} />
}
