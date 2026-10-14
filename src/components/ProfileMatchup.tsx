import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'

interface MatchupPlayer {
  id?: string
  name: string
  isYou?: boolean
}

export function ProfileMatchup({ pair, opponents, pairLabel, score }: {
  pair: MatchupPlayer[]
  opponents: MatchupPlayer[]
  pairLabel?: string
  score?: { yours: number; opponents: number } | null
}) {
  const { t } = useTranslation()
  return <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
    <Pair players={pair} label={pairLabel ?? t('me.pair')} highlighted />
    <div className="self-center text-center">
      {score ? <p className="whitespace-nowrap text-xl font-black tabular-nums text-green-950" aria-label={t('me.scoreLabel', { yours: score.yours, opponents: score.opponents })}>
        {score.yours}<span aria-hidden="true" className="mx-1 text-gray-300">:</span>{score.opponents}
      </p> : <span className="text-[10px] font-black tracking-widest text-gray-400" aria-label={t('personal.versus')}>VS</span>}
    </div>
    <Pair players={opponents} label={t('personal.opponents')} />
  </div>
}

function Pair({ players, label, highlighted = false }: { players: MatchupPlayer[]; label: string; highlighted?: boolean }) {
  const { t } = useTranslation()
  const { leaguePath } = useLeague()
  return <div className={`min-w-0 self-stretch rounded-lg p-2.5 sm:p-3 ${highlighted ? 'bg-green-50' : 'bg-gray-50'}`}>
    <p className={`mb-2 text-[10px] font-bold uppercase tracking-wide ${highlighted ? 'text-green-700' : 'text-gray-500'}`}>{label}</p>
    <ul className="space-y-1.5">{players.length ? players.map((player, index) => <li key={player.id ?? `${player.name}-${index}`} className="text-[13px] font-semibold leading-5 text-gray-900 [overflow-wrap:anywhere]">
      {player.id ? <Link to={leaguePath(`/players/${player.id}`)} className="rounded underline-offset-2 hover:text-green-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">{player.name}</Link> : player.name}
      {player.isYou ? <span className="ml-1.5 inline-block rounded bg-green-100 px-1 py-0.5 align-middle text-[9px] font-bold leading-none text-green-800">{t('personal.you')}</span> : null}
    </li>) : <li className="text-xs text-gray-500">{t('personal.unknownPlayer')}</li>}</ul>
  </div>
}
