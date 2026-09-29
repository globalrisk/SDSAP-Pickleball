import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

export function NotFoundPage() {
  const { t } = useTranslation()

  useEffect(() => {
    document.title = `${t('notFound.title')} · ${t('app.title')}`
  }, [t])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-green-50 to-green-100 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-green-200 bg-white p-6 text-center shadow-sm sm:p-10">
        <div className="mb-8 flex justify-center">
          <LanguageSwitcher />
        </div>
        <p className="text-7xl font-black text-green-600">404</p>
        <h1 className="mt-4 text-2xl font-bold text-green-900">{t('notFound.title')}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">{t('notFound.message')}</p>
        <Link
          to="/"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-green-600 px-6 py-3 font-bold text-white transition-colors hover:bg-green-700"
        >
          {t('notFound.backHome')}
        </Link>
      </div>
    </main>
  )
}
