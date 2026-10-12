import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { useSeason } from '../context/SeasonContext'
import { fetchPickleSettings, savePickleSettings } from '../lib/picklePointsApi'
import { formatPicklePoints, isPicklePrize } from '../lib/picklePoints'
import type { PicklePreview, PicklePrizeAmounts } from '../lib/picklePoints'
import { usePicklePreview } from '../hooks/usePicklePoints'
import { ErrorState } from './Layout'

function PrizeForm({ scope, id, amounts, title, locked }: {
  scope: 'league' | 'season'; id: string; amounts: PicklePrizeAmounts; title: string; locked: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [matchPrize, setMatchPrize] = useState(amounts.matchPrize)
  const [championPrize, setChampionPrize] = useState(amounts.championPrize)
  const mutation = useMutation({ mutationFn: () => savePickleSettings(scope, id, { matchPrize, championPrize }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pickle-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['pickle-preview'] }),
      ])
    },
  })
  const valid = isPicklePrize(matchPrize) && isPicklePrize(championPrize)
  return <form className="rounded-xl border border-green-200 p-4" onSubmit={(event) => { event.preventDefault(); if (valid && !locked) mutation.mutate() }}>
    <h3 className="font-bold text-green-950">{title}</h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold text-gray-800">{t('pickle.matchPrize')}
        <input type="number" min="0" max="1000000000000" step="1000" required disabled={locked || mutation.isPending} value={matchPrize} onChange={(e) => setMatchPrize(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3" />
      </label>
      <label className="text-sm font-semibold text-gray-800">{t('pickle.championPrize')}
        <input type="number" min="0" max="1000000000000" step="1000" required disabled={locked || mutation.isPending} value={championPrize} onChange={(e) => setChampionPrize(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3" />
      </label>
    </div>
    <p className="mt-2 text-xs text-gray-600">{t('pickle.amountHelp')}</p>
    {!locked ? <button type="submit" disabled={mutation.isPending || !valid} className="mt-3 min-h-11 rounded-lg bg-green-700 px-4 text-sm font-bold text-white disabled:opacity-50">{mutation.isPending ? t('leagueSettings.saving') : t('common.save')}</button> : null}
    {mutation.isSuccess ? <p role="status" className="mt-2 text-sm text-green-700">{t('pickle.saved')}</p> : null}
    {mutation.error ? <p role="alert" className="mt-2 text-sm text-red-700">{mutation.error.message}</p> : null}
  </form>
}

export function PickleDistribution({ preview }: { preview: PicklePreview }) {
  const { t } = useTranslation()
  return <div className="mt-4 space-y-3">
    <h3 className="font-bold text-green-950">{t(preview.awarded ? 'pickle.awarded' : preview.complete ? 'pickle.finalPreview' : 'pickle.provisional')}</h3>
    {!preview.configured ? <p className="text-sm text-amber-800">{t('pickle.saveFirst')}</p> : null}
    {!preview.valid ? <p role="alert" className="text-sm text-red-700">{t('pickle.invalidResults')}</p> : null}
    {!preview.complete ? <p className="text-sm text-gray-600">{t('pickle.pendingBonus')}</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      {preview.squads.map((squad) => <div key={squad.id} className="rounded-xl border border-green-200 bg-green-50/60 p-4">
        <h4 className="font-bold text-green-950">{squad.name}</h4>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-3"><dt>{t('pickle.wins')}</dt><dd>{squad.wins}</dd></div>
          <div className="flex justify-between gap-3"><dt>{t('pickle.matchTotal')}</dt><dd>{formatPicklePoints(squad.matchTotal)}</dd></div>
          <div className="flex justify-between gap-3"><dt>{t('pickle.championPrize')}</dt><dd>{squad.championTotal === null ? t('pickle.pending') : formatPicklePoints(squad.championTotal)}</dd></div>
          <div className="flex justify-between gap-3 font-bold"><dt>{t('pickle.squadTotal')}</dt><dd>{formatPicklePoints(squad.total)}</dd></div>
          <div className="flex justify-between gap-3"><dt>{t('pickle.members')}</dt><dd>{squad.memberCount}</dd></div>
          <div className="flex justify-between gap-3 font-bold"><dt>{t('pickle.each')}</dt><dd>{squad.share === null ? '—' : formatPicklePoints(squad.share)}</dd></div>
        </dl>
        <ul className="mt-3 border-t border-green-200 pt-2 text-xs text-green-900">{squad.members.map((member) => <li key={member.id} className="flex justify-between gap-2 py-1"><span>{member.name}</span><span>{squad.share === null ? '—' : formatPicklePoints(squad.share)}</span></li>)}</ul>
      </div>)}
    </div>
    <p className="text-xs text-gray-600">{t('pickle.splitHelp')}</p>
  </div>
}

export function PicklePrizeSettings() {
  const { t } = useTranslation()
  const { league } = useLeague()
  const { selectedSeason } = useSeason()
  const season = selectedSeason?.format === 'team_duel' ? selectedSeason : undefined
  const settings = useQuery({ queryKey: ['pickle-settings', league.id, season?.id], queryFn: () => fetchPickleSettings(league.id, season?.id) })
  const preview = usePicklePreview(season?.id)
  if (settings.isLoading) return <p>{t('common.loading')}</p>
  if (settings.error) return <ErrorState message={settings.error.message} />
  if (!settings.data) return null
  const locked = league.status === 'archived'
  return <section className="mb-6 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-green-900">{t('pickle.settingsTitle')}</h2>
    <p className="mt-1 text-sm text-gray-600">{t('pickle.settingsHelp')}</p>
    <div className="mt-4 space-y-4">
      <PrizeForm key={`league:${league.id}`} scope="league" id={league.id} amounts={settings.data.defaults} title={t('pickle.defaults')} locked={locked} />
      {season && settings.data.season ? <PrizeForm key={`season:${season.id}`} scope="season" id={season.id} amounts={settings.data.season} title={t('pickle.seasonSettings', { name: season.name })} locked={locked || season.status === 'archived'} /> : <p className="text-sm text-gray-600">{t('pickle.selectDuel')}</p>}
      {season?.status === 'archived' ? <p className="text-sm text-amber-800">{t('pickle.locked')}</p> : null}
      {preview.isLoading ? <p>{t('common.loading')}</p> : preview.error ? <ErrorState message={preview.error.message} /> : preview.data ? <PickleDistribution preview={preview.data} /> : null}
    </div>
  </section>
}
