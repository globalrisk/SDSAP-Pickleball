import type { PoolPlayer } from '../types'
import { teamWinProbability } from './ratings'
import { forecastSeason, type SeasonForecast } from './seasonForecast'
import { type LeagueDuelGame } from './leagueDuelSchedule'

export const FLEXIBLE_DUEL_VERSION = 1
const EPS = 1e-12
export const DEFAULT_MAX_MATCH_PROBABILITY = .65
export interface DuelGenerationSettings { maxPartnerMeetings: number | null; maxOpponentMeetings: number | null; maxMatchProbability?: number; maxRatingDifference?: number | null }
export function duelMatchProbabilityLimit(settings: DuelGenerationSettings): number {
  return settings.maxMatchProbability ?? DEFAULT_MAX_MATCH_PROBABILITY
}
export type DuelOptionKind = 'balance' | 'variety'
export interface DuelPlayerExperience {
  id: string; games: number; expectedWins: number; below40: number; disadvantage: number
  partners: number; opponents: number
}
export interface DuelMetrics {
  worstFavorite: number; within60: number; averageFavorite: number; forecast: SeasonForecast
  partnerCounts: number[][][]; opponentCounts: number[][]; coveredOpponents: number; usedPartners: number
  maxPartnerMeetings: number; maxOpponentMeetings: number; players: DuelPlayerExperience[]
  backToBack: number; maxIdleGames: number
}
export interface DuelScheduleOption {
  id: string; kind: DuelOptionKind; games: LeagueDuelGame[]; metrics: DuelMetrics
  solver?: { status: 'OPTIMAL' | 'FEASIBLE'; elapsedMs: number }
}
export interface FlexibleDuelPlan {
  version: number; inputKey: string; splitId: string; settings: DuelGenerationSettings
  squads: [string[], string[]]; option: Omit<DuelScheduleOption, 'kind'> & { kind: DuelOptionKind | 'experience' | 'alternative' }
  engine?: 'cp-sat' | 'exhaustive'
}
/** Legacy plans remain readable, but only current solver options can be reused. */
export function isCurrentDuelPlan(plan: FlexibleDuelPlan): plan is FlexibleDuelPlan & { option: DuelScheduleOption } {
  return plan.engine === 'cp-sat' && (plan.option.kind === 'balance' || plan.option.kind === 'variety')
}
export interface DuelSearchInput {
  pool: PoolPlayer[]; settings: DuelGenerationSettings; inputKey: string; partnerHistory: string[][]
}
export interface DuelSplit { id: string; squads: [string[], string[]]; bestWorst: number }
export function validateDuelSettings(size: number, settings: DuelGenerationSettings): void {
  if (!Number.isInteger(size) || size < 4 || size > 7) throw new Error('DUEL_SIZE')
  for (const value of [settings.maxPartnerMeetings, settings.maxOpponentMeetings]) {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > size - 1)) throw new Error('DUEL_LIMIT_RANGE')
  }
  if (settings.maxOpponentMeetings !== null && size * settings.maxOpponentMeetings < 2 * (size - 1)) throw new Error('DUEL_OPPONENT_LIMIT_IMPOSSIBLE')
  const gap = settings.maxRatingDifference
  if (gap != null && (!Number.isFinite(gap) || !Number.isInteger(gap) || gap < 0)) throw new Error('DUEL_RATING_LIMIT_RANGE')
  const limit = duelMatchProbabilityLimit(settings)
  if (!Number.isFinite(limit) || limit < .5 || limit > 1) throw new Error('DUEL_MATCH_LIMIT_RANGE')
}

export function hasUniqueDuelMatchups(games: readonly LeagueDuelGame[]): boolean {
  return new Set(games.map(g => [...g.homePoolPlayerIds, ...g.awayPoolPlayerIds].sort().join(':'))).size === games.length
}

export function duelScheduleId(games: readonly LeagueDuelGame[]): string {
  return games.map(g => [...g.homePoolPlayerIds].sort().join(':') + '/' + [...g.awayPoolPlayerIds].sort().join(':')).sort().join('|')
}

/** Hard cap across all four participants, using unrounded league ratings. */
export function isDuelRatingDifferenceAllowed(pool: readonly PoolPlayer[], games: readonly LeagueDuelGame[], limit?: number | null): boolean {
  if (limit == null) return true
  const ratings = new Map(pool.map(p => [p.id, p.rating]))
  return games.every(g => {
    const values = [...g.homePoolPlayerIds, ...g.awayPoolPlayerIds].map(id => ratings.get(id))
    return values.every((value): value is number => value !== undefined && Number.isFinite(value))
      && Math.max(...values) - Math.min(...values) <= limit
  })
}

/** Optimize only order; back-to-back costs depend on the last/first game of adjacent rounds. */
export function orderDuelGames(games: LeagueDuelGame[]): LeagueDuelGame[] {
  const groups = [...new Set(games.map(g => g.roundNumber))].map(r => games.filter(g => g.roundNumber === r))
  const permutations: number[][] = []
  function permute(rest: number[], chosen: number[]) {
    if (!rest.length) permutations.push(chosen)
    else for (const i of rest) permute(rest.filter(v => v !== i), [...chosen, i])
  }
  permute(Array.from({ length: groups[0]!.length }, (_, i) => i), [])
  const variants = groups.map(gs => permutations.map(p => p.map(i => gs[i]!)))
  const participants = (g: LeagueDuelGame) => [...g.homePoolPlayerIds, ...g.awayPoolPlayerIds]
  const memo = new Map<string, { cost: number; path: number[] }>(), full = (1 << groups.length) - 1, width = permutations.length
  function visit(mask: number, last: number): { cost: number; path: number[] } {
    if (mask === full) return { cost: 0, path: [] }
    const key = `${mask}:${last}`, cached = memo.get(key); if (cached) return cached
    let best = { cost: Infinity, path: [] as number[] }
    for (let r = 0; r < groups.length; r++) if (!(mask & (1 << r))) for (let p = 0; p < width; p++) {
      const index = r * width + p, tail = visit(mask | (1 << r), index)
      const previous = last < 0 ? [] : participants(variants[Math.floor(last / width)]![last % width]!.at(-1)!)
      const cost = previous.filter(id => participants(variants[r]![p]![0]!).includes(id)).length + tail.cost
      if (cost < best.cost) best = { cost, path: [index, ...tail.path] }
    }
    memo.set(key, best); return best
  }
  return visit(0, -1).path.flatMap((v, r) => variants[Math.floor(v / width)]![v % width]!.map(g => ({ ...g, roundNumber: r + 1 }))).map((g, i) => ({ ...g, sequenceNumber: i + 1 }))
}

export function measureDuelSchedule(squads: [PoolPlayer[], PoolPlayer[]], games: LeagueDuelGame[]): DuelMetrics {
  const size = squads[0].length, pool = new Map(squads.flat().map(p => [p.id, p]))
  const partnerCounts = squads.map(() => Array.from({ length: size }, () => Array<number>(size).fill(0))), opponentCounts = Array.from({ length: size }, () => Array<number>(size).fill(0))
  const players: DuelPlayerExperience[] = squads.flat().map(p => ({ id: p.id, games: 0, expectedWins: 0, below40: 0, disadvantage: 0, partners: 0, opponents: 0 }))
  const byId = new Map(players.map(p => [p.id, p])), probabilities: number[] = [], appearances = new Map<string, number[]>()
  const skill = (ids: string[]) => ids.map(id => { const p = pool.get(id)!; return { rating: p.rating, rd: p.rating_deviation, volatility: 0 } })
  games.forEach((g, gameIndex) => {
    const p = teamWinProbability(skill(g.homePoolPlayerIds), skill(g.awayPoolPlayerIds))!; probabilities.push(p)
    for (const [side, ids] of [[0, g.homePoolPlayerIds], [1, g.awayPoolPlayerIds]] as const) {
      const indices = ids.map(id => squads[side].findIndex(p => p.id === id)), chance = side === 0 ? p : 1 - p
      partnerCounts[side]![indices[0]!]![indices[1]!]!++; partnerCounts[side]![indices[1]!]![indices[0]!]!++
      for (const id of ids) { const player = byId.get(id)!; player.games++; player.expectedWins += chance; player.below40 += Number(chance < .4); player.disadvantage += Math.max(0, .5 - chance); appearances.set(id, [...(appearances.get(id) ?? []), gameIndex]) }
    }
    for (const a of g.homePoolPlayerIds) for (const b of g.awayPoolPlayerIds) opponentCounts[squads[0].findIndex(p => p.id === a)]![squads[1].findIndex(p => p.id === b)]!++
  })
  squads.forEach((s, side) => s.forEach((p, i) => { const row = byId.get(p.id)!; row.partners = partnerCounts[side]![i]!.filter(n => n > 0).length; row.opponents = (side === 0 ? opponentCounts[i]! : opponentCounts.map(r => r[i]!)).filter(n => n > 0).length }))
  const gaps = [...appearances.values()].flatMap(a => a.slice(1).map((v, i) => v - a[i]! - 1)), favorites = probabilities.map(p => Math.max(p, 1 - p))
  return { worstFavorite: Math.max(...favorites), within60: favorites.filter(p => p <= .6 + EPS).length, averageFavorite: favorites.reduce((s, p) => s + p, 0) / favorites.length, forecast: forecastSeason(probabilities), partnerCounts, opponentCounts, coveredOpponents: opponentCounts.flat().filter(n => n > 0).length, usedPartners: partnerCounts.reduce((sum, m) => sum + m.reduce((s, row, i) => s + row.slice(i + 1).filter(n => n > 0).length, 0), 0), maxPartnerMeetings: Math.max(...partnerCounts.flat(2)), maxOpponentMeetings: Math.max(...opponentCounts.flat()), players, backToBack: gaps.filter(n => n === 0).length, maxIdleGames: Math.max(0, ...gaps) }
}
