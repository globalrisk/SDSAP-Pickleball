import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { saveTeamAppearance } from '../lib/leagueTeamDuelApi'
import { TeamColorField } from './TeamColorField'
import type { Team } from '../types'

export function LeagueDuelTeamNameForm({ team, disabled }: { team: Team; disabled: boolean }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const original = JSON.stringify([team.id, team.name, team.color])
  const [draft, setDraft] = useState<{ original: string; name: string; color: string } | null>(null)
  const name = draft?.original === original ? draft.name : team.name
  const color = draft?.original === original ? draft.color : team.color
  const trimmed = name.trim()
  const changed = trimmed !== team.name || color.toLowerCase() !== team.color.toLowerCase()
  const mutation = useMutation({
    mutationFn: (next: { name: string; color: string }) => saveTeamAppearance(team.season_id, team.id, next.name, next.color),
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
        if (!blocked && trimmed && changed && trimmed.length <= 120) mutation.mutate({ name: trimmed, color })
      }}>
      <label className="block text-sm font-semibold text-green-950" htmlFor={`duel-team-name-${team.id}`}>{t('setup.teamNameLabel')}</label>
      <input id={`duel-team-name-${team.id}`} value={name} maxLength={120} required disabled={blocked}
        onChange={(event) => { setDraft({ original, name: event.target.value, color }); mutation.reset() }}
        className="min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-50 sm:text-sm" />
      <TeamColorField value={color} disabled={blocked} onChange={nextColor => { setDraft({ original, name, color: nextColor }); mutation.reset() }} />
      <button type="submit" disabled={blocked || !trimmed || !changed || trimmed.length > 120}
        className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">{mutation.isPending ? t('common.loading') : t('common.save')}</button>
      {mutation.isSuccess ? <p role="status" className="text-sm text-green-800">{t('leagueDuel.teamRenamed')}</p> : null}
      {mutation.error ? <p role="alert" className="text-sm text-red-700">{t('setup.saveFailed', { message: mutation.error.message })}</p> : null}
    </form>
  </details>
}
