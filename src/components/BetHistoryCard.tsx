import { useTranslation } from 'react-i18next'
import type { PickleBet } from '../lib/betsApi'
import { betHistoryResult, type BetHistorySummary } from '../lib/betHistory'
import { formatSignedPicklePoints } from '../lib/picklePoints'

export function BetHistoryCard({ bet, playerId, summary, seasonName }: {
  bet: PickleBet; playerId: string; summary?: BetHistorySummary; seasonName?: string
}) {
  const { t, i18n } = useTranslation()
  const { outcome, net } = betHistoryResult(bet, summary)
  const backedHome = bet.creatorId === playerId
    ? bet.creatorSide === bet.homeTeamId : bet.creatorSide !== bet.homeTeamId
  const backed = backedHome ? bet.homeNames : bet.awayNames
  const opposing = backedHome ? bet.awayNames : bet.homeNames
  const tone = outcome === 'won' ? 'text-green-800' : outcome === 'lost' ? 'text-red-700' : 'text-gray-600'
  const date = summary?.settledAt ?? bet.createdAt
  return <article className="min-w-0 rounded-xl border border-green-200 bg-white p-4">
    <header className={`flex flex-wrap items-center justify-between gap-2 ${tone}`}>
      <h2 className="text-base font-bold">{t(`betHistory.${outcome}`)}</h2>
      {net !== null ? <p className="text-lg font-bold tabular-nums" aria-label={t('betHistory.netChange', { amount: formatSignedPicklePoints(net) })}>{formatSignedPicklePoints(net)}</p> : null}
    </header>
    <p className="mt-2 text-sm font-semibold text-green-950 [overflow-wrap:anywhere]">{t('betHistory.backed', { pair: backed.join(' + ') })}</p>
    <p className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]">{t('common.vs')} {opposing.join(' + ')}</p>
    <p className="mt-2 text-xs text-gray-500">{summary?.seasonName ?? seasonName}{summary?.seasonName || seasonName ? ' · ' : ''}<time dateTime={date}>{new Date(date).toLocaleDateString(i18n.language)}</time></p>
  </article>
}
