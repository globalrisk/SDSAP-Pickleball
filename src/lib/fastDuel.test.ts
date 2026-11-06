import { describe, expect, it } from 'vitest'
import { chooseFastDuelSplit, decodeFastDuelOptions } from './fastDuel'
import { findDuelSchedule, type DuelSearchInput } from './flexibleDuel'

const input = (): DuelSearchInput => ({ pool: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, rating: 1500, rating_deviation: 90, status: 'active', initial_rating: 1500, volatility: 0, created_at: '' })), inputKey: 'key', settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 2 }, partnerHistory: [] })

describe('Fast Team Duel client', () => {
  it('chooses unseen complete balanced splits while preserving inputs', () => {
    const data = input(), before = structuredClone(data), first = chooseFastDuelSplit(data, undefined, [], () => 0)!
    const next = chooseFastDuelSplit(data, first, [first.id], () => .5)!
    expect(first.id).not.toBe(next.id)
    expect(new Set(next.squads.flat()).size).toBe(8)
    expect(next.squads[0]).toContain('p0')
    expect(data).toEqual(before)
  })
  it('keeps mixed fourteen-player shuffles close to equal squad totals', () => {
    const data = input()
    const ratings = [1914, 1875, 1837, 1822, 1652, 1591, 1530, 1496, 1471, 1372, 1334, 1219, 977, 880]
    data.pool = ratings.map((rating, i) => ({ ...data.pool[0]!, id: `p${i}`, rating }))
    const total = (ids: string[]) => ids.reduce((sum, id) => sum + data.pool.find(p => p.id === id)!.rating, 0)
    for (let i = 0; i < 20; i++) {
      const split = chooseFastDuelSplit(data, undefined, [], () => i / 20)!
      expect(new Set(split.squads.flat()).size).toBe(14)
      expect(Math.abs(total(split.squads[0]) - total(split.squads[1]))).toBeLessThanOrEqual(36)
    }
  })
  it('recomputes metrics and rejects tampered, duplicated, or conflicting fixtures', () => {
    const data = input(), split = chooseFastDuelSplit(data, undefined, [], () => 0)!
    const squads = split.squads.map(side => side.map(id => data.pool.find(p => p.id === id)!)) as [typeof data.pool, typeof data.pool]
    const games = findDuelSchedule(squads, data.settings, .500001)!
    const raw = { kind: 'balance', games, solver: { status: 'FEASIBLE', elapsedMs: 100 } }
    const options = decodeFastDuelOptions(data, split, [raw])
    expect(options[0]!.metrics.worstFavorite).toBeCloseTo(.5)
    const mismatched = structuredClone(data)
    mismatched.pool.find(p => p.id === games[0]!.homePoolPlayerIds[0])!.rating = 2500
    mismatched.pool.find(p => p.id === split.squads[1].find(id => !games[0]!.awayPoolPlayerIds.includes(id)))!.rating = 2500
    expect(() => decodeFastDuelOptions({ ...mismatched, settings: { ...data.settings, maxMatchProbability: .6 } }, split, [raw])).toThrow('INVALID_RESULT')
    expect(options[0]!.metrics.players.every(p => p.games === 3)).toBe(true)
    expect(() => decodeFastDuelOptions(data, split, [raw, raw])).toThrow('INVALID_RESULT')
    const invalid = structuredClone(raw); invalid.games[0]!.homePoolPlayerIds[0] = 'outside'
    expect(() => decodeFastDuelOptions(data, split, [invalid])).toThrow('INVALID_RESULT')
    const conflict = structuredClone(raw); conflict.games[1]!.roundNumber = 2
    expect(() => decodeFastDuelOptions(data, split, [conflict])).toThrow('INVALID_RESULT')
  })
})
