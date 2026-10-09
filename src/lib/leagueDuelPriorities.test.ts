import { describe, expect, it } from 'vitest'
import { buildTierMatchedDuelSchedules, duelTierForRank, duelOpponentMeetingCaps } from './leagueDuelSchedule'
import { generateLeagueTeamDuelSchedule } from './teamDuelSchedule'
import { teamWinProbability } from './ratings'
import type { PoolPlayer } from '../types'

// Independent reference: fill each game from all compatible pairs, with Sets
// checking partnership coverage and round attendance instead of round bit masks.
function reference(squads: [PoolPlayer[], PoolPlayer[]], middleLimit = 3) {
  const size = squads[0].length
  const counts = ['top', 'middle', 'bottom'].map(tier => squads[0].filter((_, i) => duelTierForRank(i + 1, size) === tier).length)
  const caps = counts.map((count, index) => index === 1 ? middleLimit : Math.ceil((size + count - 2) / count))
  const capForRank = (rank: number) => caps[['top', 'middle', 'bottom'].indexOf(duelTierForRank(rank + 1, size))]!
  const home = generateLeagueTeamDuelSchedule(size).flatMap((round) => round.matches)
  const pairs: [number, number][] = []
  for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) pairs.push([a, b])
  const tier = (pair: readonly number[]) => pair.map((rank) => duelTierForRank(rank + 1, size)).sort().join(':')
  const options = home.map((game) => pairs.filter((pair) => tier(pair) === tier(game.rankPair.map((rank) => rank - 1))))
  const gameProbability = home.map((game, i) => new Map(options[i]!.map((pair) => {
    const skills = (side: number, ids: readonly number[]) => ids.map((id) => ({
      rating: squads[side]![id]!.rating, rd: squads[side]![id]!.rating_deviation, volatility: 0,
    }))
    const p = teamWinProbability(skills(0, game.rankPair.map((rank) => rank - 1)), skills(1, pair))!
    return [pair.join(':'), p]
  })))
  type Score = { worst: number; total: number; encounters: number[]; seasonImbalance: number; seasonHomeWin: number }
  let balanced: Score | undefined, varied: Score | undefined
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
    return 0
  }
  function visit(i: number, used: Set<string>, present: Set<number>, assigned: [number, number][]) {
    if (i === home.length) {
      const encounters = Array<number>(size * size).fill(0)
      const probabilities = assigned.map((pair, index) => {
        for (const h of home[index]!.rankPair) for (const a of pair) encounters[(h - 1) * size + a]!++
        return gameProbability[index]!.get(pair.join(':'))!
      })
      if (encounters.some((count, index) => count > Math.min(capForRank(Math.floor(index / size)), capForRank(index % size)))) return
      let distribution = [1]
      for (const p of probabilities) {
        const next = Array<number>(distribution.length + 1).fill(0)
        distribution.forEach((weight, wins) => { next[wins]! += weight * (1 - p); next[wins + 1]! += weight * p })
        distribution = next
      }
      const seasonHomeWin = distribution.filter((_, wins) => wins > probabilities.length / 2).reduce((a, b) => a + b, 0)
      const seasonAwayWin = distribution.filter((_, wins) => wins < probabilities.length / 2).reduce((a, b) => a + b, 0)
      const favorites = probabilities.map(p => Math.round(Math.max(p, 1 - p) * 1e12) / 1e12)
      const score = { worst: Math.max(...favorites), total: Math.round(favorites.reduce((sum, p) => sum + p - 0.5, 0) * 1e12) / 1e12,
        encounters: encounters.sort((a, b) => b - a), seasonHomeWin,
        seasonImbalance: Math.round(Math.abs(seasonHomeWin - seasonAwayWin) / (seasonHomeWin + seasonAwayWin) * 1e12) / 1e12 }
      const balanceOrder = (previous: Score) => score.worst - previous.worst || score.total - previous.total
      if (!balanced || (balanceOrder(balanced) || score.seasonImbalance - balanced.seasonImbalance || compare(score.encounters, balanced.encounters)) < 0) balanced = score
      if (!varied || (compare(score.encounters, varied.encounters) || score.seasonImbalance - varied.seasonImbalance || balanceOrder(varied)) < 0) varied = score
      return
    }
    const inRound = i && home[i]!.roundNumber === home[i - 1]!.roundNumber ? present : new Set<number>()
    for (const pair of options[i]!) {
      const key = pair.join(':')
      if (used.has(key) || pair.some((rank) => inRound.has(rank))) continue
      visit(i + 1, new Set([...used, key]), new Set([...inRound, ...pair]), [...assigned, pair])
    }
  }
  visit(0, new Set(), new Set(), [])
  return { balance: balanced!, opponent_variety: varied! }
}

describe('priority optimization against exhaustive reference schedules', () => {
  for (const size of [4, 5, 6, 7]) it(`optimizes both goals for ${size}-player squads with unequal ratings and uncertainty`, () => {
    const players: PoolPlayer[] = Array.from({ length: size * 2 }, (_, i) => ({
      id: `p${i}`, name: `Player ${i}`, status: 'active', rating: 2100 - i * 79,
      rating_deviation: 40 + i * 11, initial_rating: 1500, volatility: 0, created_at: '',
    }))
    const squads: [PoolPlayer[], PoolPlayer[]] = [players.filter((_, i) => i % 2 === 0), players.filter((_, i) => i % 2 === 1)]
    const expected = reference(squads)
    expect(expected.balance, 'tier caps must admit a complete schedule').toBeDefined()
    const actual = buildTierMatchedDuelSchedules(squads)
    for (const priority of ['balance', 'opponent_variety'] as const) {
      expect(actual[priority].worstFavorite).toBe(expected[priority].worst)
      expect(actual[priority].totalImbalance).toBe(expected[priority].total)
      expect(actual[priority].opponentEncounterCounts).toEqual(expected[priority].encounters)
      expect(actual[priority].seasonForecast.homeWinProbability).toBeCloseTo(expected[priority].seasonHomeWin, 10)
      const games = actual[priority].games
      const caps = duelOpponentMeetingCaps(size)
      for (const [h, home] of squads[0].entries()) for (const [a, away] of squads[1].entries()) {
        const meetings = games.filter(game => game.homePoolPlayerIds.includes(home.id) && game.awayPoolPlayerIds.includes(away.id)).length
        expect(meetings).toBeLessThanOrEqual(Math.min(caps[duelTierForRank(h + 1, size)], caps[duelTierForRank(a + 1, size)]))
      }
      for (const side of [0, 1] as const) {
        const ids = side === 0 ? 'homePoolPlayerIds' : 'awayPoolPlayerIds'
        expect(new Set(games.map((game) => [...game[ids]].sort().join(':'))).size).toBe(size * (size - 1) / 2)
        for (const player of squads[side]) {
          const appearances = games.filter((game) => game[ids].includes(player.id))
          expect(appearances).toHaveLength(size - 1)
          expect(new Set(appearances.map((game) => game.roundNumber)).size).toBe(size - 1)
        }
      }
    }
    if (size <= 5) expect(reference(squads, 2).balance, 'middle limit 2 cannot preserve all partnerships and rounds').toBeUndefined()
  })
  it('reports the feasible top, middle, and bottom limits for all supported sizes', () => {
    expect([4, 5, 6, 7].map(duelOpponentMeetingCaps)).toEqual([
      { top: 3, middle: 3, bottom: 3 }, { top: 4, middle: 3, bottom: 4 },
      { top: 3, middle: 3, bottom: 3 }, { top: 4, middle: 3, bottom: 4 },
    ])
  })
})
