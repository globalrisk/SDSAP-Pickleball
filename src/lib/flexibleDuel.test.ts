import { describe, expect, it } from 'vitest'
import { duelScheduleId, findDuelSchedule, measureDuelSchedule, orderDuelGames, searchDuelOptions, searchDuelSplits, selectNextDuelSplit, validateDuelSettings, type DuelSearchInput } from './flexibleDuel'
import { teamWinProbability } from './ratings'
import { forecastSeason, isSeasonForecastBalanced } from './seasonForecast'
import type { PoolPlayer } from '../types'
import { generateLeagueTeamDuelSchedule } from './teamDuelSchedule'

function pool(n: number): PoolPlayer[] { return Array.from({ length: n }, (_, i) => ({ id: `p${i.toString().padStart(2, '0')}`, name: `Player ${i}`, rating: 1500, rating_deviation: 90, initial_rating: 1500, volatility: 0, status: 'active', created_at: '' })) }
function input(n = 8): DuelSearchInput { return { inputKey: 'snapshot', pool: pool(n), settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 2 }, partnerHistory: [] } }

describe('flexible exhaustive scheduling', () => {
  it('rejects impossible or fractional caps instead of relaxing them', () => {
    expect(() => validateDuelSettings(6, { maxPartnerMeetings: 2, maxOpponentMeetings: 1 })).toThrow('IMPOSSIBLE')
    expect(() => validateDuelSettings(6, { maxPartnerMeetings: 1.5, maxOpponentMeetings: 2 })).toThrow('RANGE')
    expect(() => validateDuelSettings(6, { maxPartnerMeetings: null, maxOpponentMeetings: null })).not.toThrow()
  })
  for (const size of [4, 5, 6, 7]) it(`finds conflict-free equal participation for ${size}-player squads`, () => {
    const ps = pool(size * 2), squads = [ps.slice(0, size), ps.slice(size)] as [PoolPlayer[], PoolPlayer[]]
    const games = findDuelSchedule(squads, { maxPartnerMeetings: 1, maxOpponentMeetings: null }, .500001)!
    expect(games).not.toBeNull()
    const ordered = orderDuelGames(games), m = measureDuelSchedule(squads, ordered)
    expect(m.players.every(p => p.games === size - 1)).toBe(true)
    expect(m.maxPartnerMeetings).toBe(1)
    expect(ordered).toHaveLength(size * (size - 1) / 2)
    for (const r of new Set(ordered.map(g => g.roundNumber))) {
      const ids = ordered.filter(g => g.roundNumber === r).flatMap(g => [...g.homePoolPlayerIds, ...g.awayPoolPlayerIds])
      expect(new Set(ids).size).toBe(ids.length)
    }
    expect(duelScheduleId(ordered)).toBe(duelScheduleId(games))
    expect(isSeasonForecastBalanced(m.forecast)).toBe(true)
  }, 30000)
  it('returns distinct honest options and refreshes without modifying inputs', () => {
    const data = input(), before = structuredClone(data), catalog = searchDuelSplits(data), split = catalog.splits[0]!
    const options = searchDuelOptions(data, split)
    expect(options).toHaveLength(3)
    expect(new Set(options.map(o => o.id)).size).toBe(3)
    for (const option of options) {
      expect(option.metrics.maxPartnerMeetings).toBeLessThanOrEqual(2)
      expect(option.metrics.maxOpponentMeetings).toBeLessThanOrEqual(2)
      expect(isSeasonForecastBalanced(option.metrics.forecast)).toBe(true)
      expect(option.metrics.worstFavorite).toBeLessThanOrEqual(split.bestWorst + .05 + 1e-12)
    }
    expect(options[2]!.kind).toBe('alternative')
    const refreshed = searchDuelOptions(data, split, options.map(o => o.id))
    expect(refreshed.every(o => !options.some(previous => o.id === previous.id))).toBe(true)
    expect(data).toEqual(before)
    expect(selectNextDuelSplit(catalog, split, [split.id])?.id).not.toBe(split.id)
  })
  it('returns no alternatives when no split meets the hard season limit', () => {
    const data = input()
    data.pool.forEach((p, i) => { p.rating = i === 0 ? 5000 : 800; p.rating_deviation = 20 })
    expect(searchDuelSplits(data)).toEqual({ globalBest: null, splits: [] })
  })
  it('uses previous partnerships only when those partners actually play together', () => {
    const data = input(), split = searchDuelSplits(data).splits[0]!
    const original = searchDuelOptions(data, split)[0]!
    const pair = [...original.games[0]!.homePoolPlayerIds].sort().join(':')
    const withHistory = { ...data, partnerHistory: [[pair]] }
    const preferred = searchDuelOptions(withHistory, split)[0]!
    expect(preferred.games.some(g => [...g.homePoolPlayerIds].sort().join(':') === pair)).toBe(false)
    expect(preferred.metrics.worstFavorite).toBe(original.metrics.worstFavorite)
  })
  it('agrees with an independent brute-force reference for all four-player-squad splits', () => {
    const data = input(); data.pool.forEach((p, i) => { p.rating += (i - 4) * 30 })
    let reference = 1
    const partitions = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]]
    for (let a = 1; a < 6; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 8; c++) {
      const home = [0, a, b, c].map(i => data.pool[i]!), away = data.pool.filter(p => !home.includes(p)), rounds: { h: number[][]; a: number[][]; ps: number[] }[] = []
      for (const h of partitions) for (const a of partitions) for (const order of [[0, 1], [1, 0]]) {
        const aPairs = order.map(i => a[i]!)
        const skill = (s: PoolPlayer[], pair: number[]) => pair.map(i => ({ rating: s[i]!.rating, rd: s[i]!.rating_deviation, volatility: 0 }))
        rounds.push({ h, a: aPairs, ps: h.map((pair, i) => teamWinProbability(skill(home, pair), skill(away, aPairs[i]!))!) })
      }
      for (let i = 0; i < rounds.length; i++) for (let j = i; j < rounds.length; j++) for (let k = j; k < rounds.length; k++) {
        const rs = [rounds[i]!, rounds[j]!, rounds[k]!], partner = new Map<string, number>(), opponents = Array(16).fill(0)
        rs.forEach(r => r.h.forEach((h, m) => { const a = r.a[m]!; for (const [s, pair] of [[0, h], [1, a]] as const) { const key = s + ':' + [...pair].sort().join(); partner.set(key, (partner.get(key) ?? 0) + 1) }; for (const x of h) for (const y of a) opponents[x * 4 + y]++ }))
        if ([...partner.values(), ...opponents].some(n => n > 2)) continue
        const probabilities = rs.flatMap(r => r.ps)
        if (isSeasonForecastBalanced(forecastSeason(probabilities))) reference = Math.min(reference, Math.max(...probabilities.map(p => Math.max(p, 1 - p))))
      }
    }
    const result = searchDuelSplits(data)
    expect(result.globalBest).toBeCloseTo(reference, 12)
    expect(result.splits.every(s => s.bestWorst <= result.globalBest! + .05 + 1e-12)).toBe(true)
  })
  it('preserves all metrics when fixture order changes', () => {
    const ps = pool(12), squads = [ps.slice(0, 6), ps.slice(6)] as [PoolPlayer[], PoolPlayer[]]
    const games = generateLeagueTeamDuelSchedule(6).flatMap(r => r.matches.map(g => ({ roundNumber: r.roundNumber, sequenceNumber: g.sequenceNumber, homePoolPlayerIds: g.rankPair.map(i => squads[0][i - 1]!.id) as [string, string], awayPoolPlayerIds: g.rankPair.map(i => squads[1][i - 1]!.id) as [string, string] })))
    expect(measureDuelSchedule(squads, orderDuelGames(games)).forecast).toEqual(measureDuelSchedule(squads, games).forecast)
  })
  it('reproduces the audited twelve-player bottleneck with both meeting caps at two', () => {
    // Anonymous rating/uncertainty snapshot; no production identifiers or names.
    const values = [[1905.84172597372,84.125761416524],[1857.4704527064,91.1037414911747],[1706.18410636561,160.197121214598],[1625.53986668777,86.6431445866471],[1617.79715237867,84.4374781289292],[1533.53734938142,85.2371195056015],[1529.98547656904,84.5174979256574],[1485.91255273442,94.2850791944359],[1341.42522086899,85.404911777654],[1320.28050380348,88.6315643045044],[1281.76551658724,87.3890373826563],[951.462826151532,95.4049852844325]]
    const ps = pool(12).map((p, i) => ({ ...p, rating: values[i]![0]!, rating_deviation: values[i]![1]! }))
    const squads = [[0,2,4,6,8,11], [1,3,5,7,9,10]].map(indices => indices.map(i => ps[i]!)) as [PoolPlayer[], PoolPlayer[]]
    const settings = { maxPartnerMeetings: 2, maxOpponentMeetings: 2 }, optimum = .6757622225238966
    expect(findDuelSchedule(squads, settings, optimum - 1e-8)).toBeNull()
    const games = findDuelSchedule(squads, settings, optimum)!
    expect(games).not.toBeNull()
    const metrics = measureDuelSchedule(squads, games)
    expect(metrics.worstFavorite).toBeCloseTo(optimum, 12)
    expect(metrics.maxPartnerMeetings).toBeLessThanOrEqual(2)
    expect(metrics.maxOpponentMeetings).toBeLessThanOrEqual(2)
    expect(isSeasonForecastBalanced(metrics.forecast)).toBe(true)
  }, 30000)
})
