import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { updatePlayerBadge } from '../lib/api'

export function PlayerBadgeEditor({ playerId, badge }: { playerId: string; badge: string }) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { league } = useLeague()
  const queryClient = useQueryClient()
  const helpId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(badge)
  const tooLong = [...draft.trim()].length > 60
  const mutation = useMutation({
    mutationFn: () => updatePlayerBadge(league.id, playerId, draft),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['player-profile', league.id] }),
        queryClient.invalidateQueries({ queryKey: ['player-rankings', league.id] }),
      ])
      setEditing(false)
    },
  })

  if (!isAdmin) return null
  return (
    <div className="mb-6">
      {editing ? (
        <form aria-label={t('badges.edit')} className="max-w-lg space-y-3 rounded-xl border border-green-200 bg-white p-4" onSubmit={event => {
          event.preventDefault()
          if (!tooLong) mutation.mutate()
        }}>
          <label className="block text-sm font-semibold text-green-950">
            {t('badges.label')}
            <input value={draft} onChange={event => setDraft(event.target.value)} disabled={mutation.isPending} aria-describedby={helpId} aria-invalid={tooLong}
              className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3 text-base" />
          </label>
          <p id={helpId} className="text-sm text-gray-600">{t('badges.help')}</p>
          {tooLong ? <p role="alert" className="text-sm text-red-700">{t('badges.tooLong')}</p> : null}
          {mutation.isError ? <p role="alert" className="text-sm text-red-700">{t('badges.error')}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button disabled={mutation.isPending || tooLong || draft.trim() === badge} className="min-h-11 rounded-lg bg-green-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
              {t(mutation.isPending ? 'badges.saving' : 'badges.save')}
            </button>
            <button type="button" disabled={mutation.isPending} onClick={() => { setEditing(false); mutation.reset() }} className="min-h-11 rounded-lg border border-green-200 px-4 py-2 text-green-900">{t('common.cancel')}</button>
          </div>
        </form>
      ) : <button type="button" onClick={() => { setDraft(badge); mutation.reset(); setEditing(true) }} className="min-h-11 rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-semibold text-green-900">{t('badges.edit')}</button>}
      {mutation.isSuccess ? <p role="status" className="mt-2 text-sm text-green-700">{t('badges.saved')}</p> : null}
    </div>
  )
}
