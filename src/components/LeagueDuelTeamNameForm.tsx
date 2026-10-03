import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { renameLeagueDuelTeam } from '../lib/leagueTeamDuelApi'
import type { Team } from '../types'

export function LeagueDuelTeamNameForm({ team, disabled }: { team: Team; disabled: boolean }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [draft, setDraft] = useState<{ original: string; name: string } | null>(null)
  const name = draft?.original === team.name ? draft.name : team.name
  const trimmed = name.trim()
  const mutation = useMutation({
    mutationFn: (nextName: string) => renameLeagueDuelTeam(team.season_id, team.id, nextName),
    onSuccess: async () => {
      await Promise.all([
        ['teams', team.season_id], ['teams-with-players', team.season_id], ['matches', team.season_id],
        ['season-recap'], ['player-profile'],
      ].map((queryKey) => client.invalidateQueries({ queryKey })))
      setDraft(null)
    },
  })
  const blocked = disabled || mutation.isPending

  return <details className="mt-2">
    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-green-800 underline underline-offset-2">{t('leagueDuel.renameTeam')}</summary>
    <form aria-label={t('leagueDuel.renameTeamNamed', { name: team.name })} className="mt-2 space-y-3 rounded-lg bg-green-50 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!blocked && trimmed && trimmed !== team.name && trimmed.length <= 120) mutation.mutate(trimmed)
      }}>
      <label className="block text-sm font-semibold text-green-950" htmlFor={`duel-team-name-${team.id}`}>{t('setup.teamNameLabel')}</label>
      <input id={`duel-team-name-${team.id}`} value={name} maxLength={120} required disabled={blocked}
        onChange={(event) => { setDraft({ original: team.name, name: event.target.value }); mutation.reset() }}
        className="min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-50 sm:text-sm" />
      <button type="submit" disabled={blocked || !trimmed || trimmed === team.name || trimmed.length > 120}
        className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">{mutation.isPending ? t('common.loading') : t('common.save')}</button>
      {mutation.isSuccess ? <p role="status" className="text-sm text-green-800">{t('leagueDuel.teamRenamed')}</p> : null}
      {mutation.error ? <p role="alert" className="text-sm text-red-700">{t('setup.saveFailed', { message: mutation.error.message })}</p> : null}
    </form>
  </details>
}
