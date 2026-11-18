import { findDuelSchedule } from './testFixtures/flexibleDuelReference'
import { describe, expect, it } from 'vitest'
import { decodeFastDuelSplit, decodeFastDuelOption, isFastDuelSplitId } from './fastDuel'
import { validateDuelSettings, type DuelSearchInput } from './flexibleDuel'

const input = (): DuelSearchInput => ({ pool: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, rating: 1500, rating_deviation: 90, status: 'active', initial_rating: 1500, volatility: 0, created_at: '' })), inputKey: 'key', settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 2 }, partnerHistory: [] })

describe('Fast Team Duel client', () => {
  it('validates ranking-point limits without accepting malformed values', () => {
    const data = input()
    for (const limit of [undefined, null, 0, 400]) expect(() => validateDuelSettings(4, { ...data.settings, maxRatingDifference: limit })).not.toThrow()
    for (const limit of [-1, .5, NaN, Infinity, '400', true]) expect(() => validateDuelSettings(4, { ...data.settings, maxRatingDifference: limit as number })).toThrow('DUEL_RATING_LIMIT_RANGE')
  })
  it('checks the unrounded four-player spread and rejects removed option kinds', () => {
    const data = input(), split = decodeFastDuelSplit(data, [data.pool.slice(0, 4), data.pool.slice(4)].map(side => side.map(p => p.id)))
    const squads = split.squads.map(side => side.map(id => data.pool.find(p => p.id === id)!)) as [typeof data.pool, typeof data.pool]
    const games = findDuelSchedule(squads, data.settings, .500001)!
    const raw = { kind: 'variety', games, solver: { status: 'FEASIBLE', elapsedMs: 100 } }
    // A global shift on one player keeps season probability in range, isolating the spread check.
    data.pool[0]!.rating = 1500.25
    data.settings.maxRatingDifference = 0
    expect(() => decodeFastDuelOption(data, split, raw)).toThrow('INVALID_RESULT')
    data.settings.maxRatingDifference = 400
    data.pool[0]!.rating = 1900
    data.settings.maxMatchProbability = 1
    // Shift the opposite squad equally so the season balance remains symmetric.
    data.pool.find(p => p.id === split.squads[1][0])!.rating = 1900
    expect(decodeFastDuelOption(data, split, raw).kind).toBe('variety')
    data.pool[0]!.rating = 1900.01
    expect(() => decodeFastDuelOption(data, split, raw)).toThrow('INVALID_RESULT')
    data.settings.maxRatingDifference = null
    expect(decodeFastDuelOption(data, split, raw).kind).toBe('variety')
    expect(() => decodeFastDuelOption(data, split, { ...raw, kind: 'balance' })).toThrow('INVALID_RESULT')
  })

  it('requires canonical, non-mirrored splits that cover the roster exactly', () => {
    const data = input()
    expect(isFastDuelSplitId(data, 'p0:p1:p2:p3|p4:p5:p6:p7')).toBe(true)
    expect(isFastDuelSplitId(data, 'p4:p5:p6:p7|p0:p1:p2:p3')).toBe(false)
    expect(isFastDuelSplitId(data, 'p0:p1:p2:p3|p4:p5:p6:p6')).toBe(false)
    expect(() => decodeFastDuelSplit(data, [['p1', 'p0', 'p2', 'p3'], ['p4', 'p5', 'p6', 'p7']])).toThrow('INVALID_RESULT')
  })
  it('recomputes metrics and rejects tampered, duplicated, or conflicting fixtures', () => {
    const data = input(), split = decodeFastDuelSplit(data, [data.pool.slice(0, 4), data.pool.slice(4)].map(side => side.map(p => p.id)))
    const squads = split.squads.map(side => side.map(id => data.pool.find(p => p.id === id)!)) as [typeof data.pool, typeof data.pool]
    const games = findDuelSchedule(squads, data.settings, .500001)!
    const raw = { kind: 'variety', games, solver: { status: 'FEASIBLE', elapsedMs: 100 } }
    const option = decodeFastDuelOption(data, split, raw)
    expect(option.metrics.worstFavorite).toBeCloseTo(.5)
    const mismatched = structuredClone(data)
    mismatched.pool.find(p => p.id === games[0]!.homePoolPlayerIds[0])!.rating = 2500
    mismatched.pool.find(p => p.id === split.squads[1].find(id => !games[0]!.awayPoolPlayerIds.includes(id)))!.rating = 2500
    expect(() => decodeFastDuelOption({ ...mismatched, settings: { ...data.settings, maxMatchProbability: .6 } }, split, raw)).toThrow('INVALID_RESULT')
    expect(option.metrics.players.every(p => p.games === 3)).toBe(true)
    const invalid = structuredClone(raw); invalid.games[0]!.homePoolPlayerIds[0] = 'outside'
    expect(() => decodeFastDuelOption(data, split, invalid)).toThrow('INVALID_RESULT')
    const repeat = structuredClone(raw)
    repeat.games = Array.from({ length: 3 }, (_, r) => games.slice(0, 2).map((g, i) => ({ ...g, roundNumber: r + 1, sequenceNumber: r * 2 + i + 1 }))).flat()
    expect(() => decodeFastDuelOption({ ...data, settings: { maxPartnerMeetings: 3, maxOpponentMeetings: 3 } }, split, repeat)).toThrow('INVALID_RESULT')
    const conflict = structuredClone(raw); conflict.games[1]!.roundNumber = 2
    expect(() => decodeFastDuelOption(data, split, conflict)).toThrow('INVALID_RESULT')
  })
})
