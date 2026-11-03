import { addPoints, type PickleBet, type PickleTransaction } from './betsApi'

export interface BetHistorySummary {
  net: string
  seasonName: string
  settledAt: string
}

/** Wallet history belongs to the signed-in player; reversals cancel earlier payouts. */
export function summarizeBetHistory(transactions: PickleTransaction[]): Map<string, BetHistorySummary> {
  const summaries = new Map<string, BetHistorySummary>()
  for (const transaction of transactions) {
    if (!transaction.betId || transaction.kind === 'prize') continue
    const previous = summaries.get(transaction.betId)
    const latest = !previous || transaction.createdAt > previous.settledAt
    summaries.set(transaction.betId, {
      net: addPoints(previous?.net ?? '0', transaction.amount),
      seasonName: latest ? transaction.seasonName : previous.seasonName,
      settledAt: latest ? transaction.createdAt : previous.settledAt,
    })
  }
  return summaries
}

export function betHistoryResult(bet: PickleBet, summary?: BetHistorySummary) {
  if (bet.state === 'refunded' || bet.state === 'cancelled' || bet.state === 'void') {
    return { outcome: bet.state, net: '0' } as const
  }
  if (bet.state === 'settled' && summary) {
    if (summary.net.startsWith('-') && /[1-9]/.test(summary.net)) return { outcome: 'lost', net: summary.net } as const
    if (/[1-9]/.test(summary.net)) return { outcome: 'won', net: summary.net } as const
  }
  return { outcome: 'unavailable', net: null } as const
}
