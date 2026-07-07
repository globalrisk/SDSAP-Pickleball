import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isSupabaseConfigured } from '../lib/supabase'

export function SetupBanner() {
  const { t } = useTranslation()
  if (isSupabaseConfigured) return null

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">{t('error.supabaseTitle')}</p>
      <p className="mt-1">{t('error.supabaseMessage')}</p>
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-200 border-t-green-600" />
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-semibold">{t('error.title')}</p>
      <p className="mt-1 break-words">{message}</p>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: { label: string; to: string }
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-green-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-green-700">{subtitle}</p>}
      </div>
      {action && (
        <Link
          to={action.to}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 sm:w-auto sm:py-2"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
