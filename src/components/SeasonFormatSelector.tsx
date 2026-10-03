import { Select } from './Select'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { setSeasonFormat } from '../lib/leagueTeamDuelApi'
import { ErrorState } from './Layout'
import type { Season, SeasonFormat } from '../types'

export function SeasonFormatSelector({ season, locked }: { season: Season; locked: boolean }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (format: SeasonFormat) => setSeasonFormat(season.id, format),
    onSuccess: () => Promise.all(['seasons', 'teams', 'teams-with-players', 'assigned-pool-players', 'season-roster', 'league-duel-draft'].map((key) => client.invalidateQueries({ queryKey: [key] }))),
  })
  return <section className="mb-6 rounded-xl border border-green-200 bg-white p-5">
    <label className="text-lg font-semibold text-green-950" htmlFor="season-format">{t('leagueDuel.chooseFormat')}</label>
    <p className="mt-1 text-sm text-gray-600">{t(locked ? 'leagueDuel.formatLocked' : 'leagueDuel.switchHelp')}</p>
    <Select id="season-format" className="mt-3 min-h-11 w-full rounded-lg border border-green-200 px-3 py-2" value={season.format ?? 'round_robin'} disabled={locked || mutation.isPending} onValueChange={(value) => mutation.mutate(value as SeasonFormat)}>
      <option value="round_robin">{t('leagueDuel.roundRobin')}</option><option value="team_duel">{t('leagueDuel.title')}</option>
    </Select>
    {mutation.error ? <div className="mt-3"><ErrorState message={(mutation.error as Error).message} /></div> : null}
  </section>
}
