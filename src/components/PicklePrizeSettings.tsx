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
  return <form onSubmit={(event) => { event.preventDefault(); if (valid && !locked) mutation.mutate() }}>
    {title ? <h3 className="font-bold text-green-950">{title}</h3> : null}
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

export function PickleDistribution({ preview, compact = false }: { preview: PicklePreview; compact?: boolean }) {
  const { t } = useTranslation()
  if (compact) return <div className="mt-6 border-t border-green-100 pt-5">
    <h3 className="font-bold text-green-950">{t(preview.awarded ? 'pickle.awarded' : preview.complete ? 'pickle.finalPreview' : 'pickle.provisional')}</h3>
    {!preview.configured ? <p className="mt-2 text-sm text-amber-800">{t('pickle.saveFirst')}</p> : null}
    {!preview.valid ? <p role="alert" className="mt-2 text-sm text-red-700">{t('pickle.invalidResults')}</p> : null}
    {!preview.complete ? <p className="mt-2 text-sm text-gray-600">{t('pickle.pendingBonus')}</p> : null}
    <table className="mt-3 w-full table-fixed text-left text-sm">
      <thead className="text-xs text-gray-600"><tr><th scope="col" className="w-2/5 py-2 font-medium">{t('workspace.squad')}</th><th scope="col" className="py-2 text-right font-medium">{t('workspace.wins')}</th><th scope="col" className="py-2 text-right font-medium">{t('pickle.each')}</th></tr></thead>
      <tbody>{preview.squads.map(squad => <tr key={squad.id} className="border-t border-green-100"><th scope="row" className="break-words py-3 pr-2 font-semibold text-green-950">{squad.name}<span className="mt-1 block text-xs font-normal text-gray-600">{t('workspace.rosterCount', { count: squad.memberCount })}</span></th><td className="py-3 text-right">{squad.wins}</td><td className="break-words py-3 pl-2 text-right font-semibold">{squad.share === null ? '—' : formatPicklePoints(squad.share)}</td></tr>)}</tbody>
    </table>
    <p className="mt-3 text-xs text-gray-600">{t('pickle.splitHelp')}</p>
    <details className="mt-4"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-green-800">{t('workspace.fullDistribution')}</summary><PickleDistribution preview={preview} /></details>
  </div>
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
        <ul className="mt-3 border-t border-green-200 pt-2 text-xs text-green-900">{squad.members.map((member) => <li key={member.id} className="flex justify-between gap-2 py-1"><span className="min-w-0 flex-1 break-words">{member.name}</span><span className="shrink-0">{squad.share === null ? '—' : formatPicklePoints(squad.share)}</span></li>)}</ul>
      </div>)}
    </div>
    <p className="text-xs text-gray-600">{t('pickle.splitHelp')}</p>
  </div>
}

export function PicklePrizeSettings({ scope = 'both' }: { scope?: 'league' | 'season' | 'both' }) {
  const { t } = useTranslation()
  const { league } = useLeague()
  const { selectedSeason } = useSeason()
  const season = scope !== 'league' && selectedSeason?.format === 'team_duel' ? selectedSeason : undefined
  const settings = useQuery({ queryKey: ['pickle-settings', league.id, season?.id], queryFn: () => fetchPickleSettings(league.id, season?.id), enabled: scope !== 'season' || !!season })
  const preview = usePicklePreview(season?.id)
  if (scope === 'season' && !season) return <p className="rounded-xl border border-green-200 bg-white p-5 text-sm text-gray-600">{t('pickle.selectDuel')}</p>
  if (settings.isLoading) return <p>{t('common.loading')}</p>
  if (settings.error) return <ErrorState message={settings.error.message} />
  if (!settings.data) return null
  const locked = league.status === 'archived'
  return <section className="mb-6 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-green-900">{t(scope === 'league' ? 'pickle.defaults' : 'pickle.settingsTitle')}</h2>
    <p className="mt-1 text-sm text-gray-600">{t(scope === 'league' ? 'workspace.defaultPrizesHelp' : scope === 'season' ? 'workspace.seasonPrizesHelp' : 'pickle.settingsHelp', { name: season?.name })}</p>
    <div className="mt-4 space-y-4">
      {scope !== 'season' ? <PrizeForm key={`league:${league.id}`} scope="league" id={league.id} amounts={settings.data.defaults} title={scope === 'league' ? '' : t('pickle.defaults')} locked={locked} /> : null}
      {scope !== 'league' ? season && settings.data.season ? <PrizeForm key={`season:${season.id}`} scope="season" id={season.id} amounts={settings.data.season} title={t('pickle.seasonSettings', { name: season.name })} locked={locked || season.status === 'archived'} /> : <p className="text-sm text-gray-600">{t('pickle.selectDuel')}</p> : null}
      {season?.status === 'archived' ? <p className="text-sm text-amber-800">{t('pickle.locked')}</p> : null}
      {scope !== 'league' ? preview.isLoading ? <p>{t('common.loading')}</p> : preview.error ? <ErrorState message={preview.error.message} /> : preview.data ? <PickleDistribution preview={preview.data} compact={scope === 'season'} /> : null : null}
    </div>
  </section>
}
