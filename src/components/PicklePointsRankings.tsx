import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePickleLeaderboard } from '../hooks/usePicklePoints'
import { fetchPickleContributions } from '../lib/picklePointsApi'
import { formatPicklePoints } from '../lib/picklePoints'
import { ErrorState } from './Layout'
import { useLeague } from '../context/LeagueContext'

function PlayerContributions({ playerId }: { playerId: string }) {
  const { t } = useTranslation()
  const { league } = useLeague()
  const history = useQuery({ queryKey: ['pickle-points', 'contributions', league.id, playerId], queryFn: () => fetchPickleContributions(league.id, playerId), refetchOnWindowFocus: 'always' })
  if (history.isLoading) return <p className="p-3 text-sm">{t('common.loading')}</p>
  if (history.error) return <ErrorState message={history.error.message} />
  return <ul className="mt-2 space-y-2 border-t border-green-100 pt-3 text-xs text-gray-600">
    {!history.data?.length ? <li>{t('pickle.noContributions')}</li> : history.data.map((item) => <li key={item.season_id} className="flex flex-wrap justify-between gap-2">
      <span>{item.league_name} · {item.season_name} · {item.team_name}</span><span className="font-semibold text-green-800">{formatPicklePoints(item.amount)}</span>
    </li>)}
  </ul>
}

export function PicklePointsRankings() {
  const { t } = useTranslation()
  const rankings = usePickleLeaderboard()
  const [expanded, setExpanded] = useState<string | null>(null)
  if (rankings.isLoading) return <p>{t('common.loading')}</p>
  if (rankings.error) return <ErrorState message={rankings.error.message} />
  return <div>
    <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">{t('pickle.leagueHelp')}</p>
    {!rankings.data?.length ? <p>{t('rankings.empty')}</p> : <ol className="overflow-hidden rounded-xl border border-green-200 bg-white">
      {rankings.data.map((player) => <li key={player.id} className="border-b border-green-100 p-4 last:border-0">
        <button type="button" aria-expanded={expanded === player.id} aria-controls={`pickle-history-${player.id}`} onClick={() => setExpanded((prev) => prev === player.id ? null : player.id)} className="flex min-h-11 w-full items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
          <span className="min-w-8 text-sm font-bold text-green-700">#{player.rank}</span>
          <span className="min-w-0 flex-1 break-words text-sm font-semibold text-gray-900">{player.name}{player.status === 'inactive' ? <span className="ml-2 text-xs font-normal text-gray-500">{t('rankings.inactive')}</span> : null}<span className="block text-xs font-normal text-gray-500">{t('pickle.viewContributions')}</span></span>
          <span className="shrink-0 text-sm font-bold text-green-900 sm:text-base">{formatPicklePoints(player.balance)}</span>
        </button>
        <div id={`pickle-history-${player.id}`} hidden={expanded !== player.id}>{expanded === player.id ? <PlayerContributions playerId={player.id} /> : null}</div>
      </li>)}
    </ol>}
    <p className="mt-3 text-xs text-gray-600">{t('pickle.displayHelp')}</p>
  </div>
}
