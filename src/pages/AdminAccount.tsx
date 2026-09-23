import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { ErrorState, PageHeader } from '../components/Layout'
import { adminUsernameQueryKey, fetchAdminUsername, saveAdminUsername } from '../lib/adminUsernameApi'

const validUsername = /^[a-z][a-z0-9._]{2,31}$/

export function AdminAccountPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [saved, setSaved] = useState(false)
  const userId = user?.id
  const usernameQuery = useQuery({
    queryKey: adminUsernameQueryKey(userId),
    queryFn: () => fetchAdminUsername(userId!),
    enabled: !!userId,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    setUsername(usernameQuery.data ?? '')
  }, [usernameQuery.data])

  const normalized = username.trim().toLowerCase()
  const isValid = validUsername.test(normalized)
  const saveMutation = useMutation({
    mutationFn: () => saveAdminUsername(userId!, normalized),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminUsernameQueryKey(userId) })
      setSaved(true)
    },
  })

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!userId || !isValid) return
    setSaved(false)
    saveMutation.mutate()
  }

  const error = saveMutation.error as { code?: string; message?: string } | null

  return (
    <div>
      <PageHeader title={t('adminAccount.title')} subtitle={t('adminAccount.subtitle')} />
      <section className="max-w-xl rounded-2xl border border-green-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-green-950">{t('adminAccount.linkTitle')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('adminAccount.linkHelp')}</p>
        <div className="mt-5 rounded-lg border border-green-100 bg-green-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-800">{t('adminAccount.email')}</p>
          <p className="mt-1 break-all font-medium text-gray-900">{user?.email ?? '—'}</p>
        </div>
        <form onSubmit={handleSave} className="mt-5 space-y-3">
          <label className="block text-sm font-semibold text-gray-800">
            {t('adminAccount.username')}
            <input
              type="text"
              value={username}
              onChange={(event) => { setUsername(event.target.value); setSaved(false) }}
              autoComplete="username"
              maxLength={32}
              className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3 text-base focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-100"
            />
          </label>
          <p className="text-xs text-gray-600">{t('adminAccount.usernameRules')}</p>
          <button
            type="submit"
            disabled={!userId || !isValid || !usernameQuery.isSuccess || saveMutation.isPending || normalized === usernameQuery.data}
            className="min-h-11 rounded-lg bg-green-700 px-5 py-2 font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveMutation.isPending ? t('common.loading') : t('common.save')}
          </button>
        </form>
        {usernameQuery.error ? <div className="mt-3"><ErrorState message={(usernameQuery.error as Error).message} /></div> : null}
        {error ? <p className="mt-3 text-sm text-red-800" role="alert">{error.code === '23505' ? t('adminAccount.taken') : (error.message ?? t('adminAccount.saveFailed'))}</p> : null}
        {saved ? <p className="mt-3 text-sm font-semibold text-green-800" role="status">{t('adminAccount.saved')}</p> : null}
      </section>
    </div>
  )
}
