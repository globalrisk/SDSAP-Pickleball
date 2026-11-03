import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import type { PickleBet, PickleTransaction } from './betsApi'
import { betHistoryResult, summarizeBetHistory } from './betHistory'

const transaction = (amount: string, overrides: Partial<PickleTransaction> = {}): PickleTransaction => ({
  id: crypto.randomUUID(), amount, kind: 'bet', betId: 'bet', seasonName: 'Season 15',
  matchId: 'match', revision: 1, reason: 'confirmed', createdAt: '2026-11-01T00:00:00Z', ...overrides,
})
const bet = { state: 'settled' } as PickleBet

describe('Bet history outcomes', () => {
  it.each([['5000.000000', 'won'], ['-1000.000000', 'lost']])('uses the actual signed payout %s', (amount, outcome) => {
    const summary = summarizeBetHistory([transaction(amount)]).get('bet')
    expect(betHistoryResult(bet, summary)).toEqual({ outcome, net: amount })
  })

  it('combines corrections into one current outcome, regardless of transaction order', () => {
    const original = transaction('5000')
    const reversal = transaction('-5000', { kind: 'reversal', revision: 2, createdAt: '2026-11-02T00:00:00Z' })
    const corrected = transaction('-1000', { revision: 2, createdAt: reversal.createdAt })
    for (const rows of [[original, reversal, corrected], [corrected, reversal, original]]) {
      const summary = summarizeBetHistory(rows).get('bet')!
      expect(betHistoryResult(bet, summary)).toEqual({ outcome: 'lost', net: '-1000.000000' })
      expect(summary.settledAt).toBe(corrected.createdAt)
    }
  })

  it('keeps unrelated bets and season prizes out of a bet’s outcome', () => {
    const summaries = summarizeBetHistory([
      transaction('-1000'), transaction('9000', { betId: 'other' }),
      transaction('20000', { kind: 'prize', betId: null }),
    ])
    expect(summaries.size).toBe(2)
    expect(betHistoryResult(bet, summaries.get('bet')).outcome).toBe('lost')
  })

  it.each(['refunded', 'cancelled', 'void'] as const)('shows %s with no net points lost', state => {
    expect(betHistoryResult({ ...bet, state })).toEqual({ outcome: state, net: '0' })
  })

  it('does not guess a win or loss when the payout is missing', () => {
    expect(betHistoryResult(bet)).toEqual({ outcome: 'unavailable', net: null })
    expect(betHistoryResult(bet, summarizeBetHistory([transaction('0')]).get('bet')).outcome).toBe('unavailable')
  })

  it('keeps precise large balances when corrections are added', () => {
    const summary = summarizeBetHistory([transaction('9007199254740993.125000'), transaction('-0.000001')]).get('bet')!
    expect(summary.net).toBe('9007199254740993.124999')
  })
})
