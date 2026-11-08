// Historical exhaustive implementation, used only by tests and offline comparisons.
import type { PoolPlayer } from '../../types'
import { teamWinProbability } from '../ratings'
import { decisiveSeasonChances, forecastSeason, isSeasonForecastBalanced, type SeasonForecast } from '../seasonForecast'
import { compareDuelPlayers, validateLeagueDuelPool, type LeagueDuelGame } from '../leagueDuelSchedule'

export const FLEXIBLE_DUEL_VERSION = 1
const EPS = 1e-12
export const DEFAULT_MAX_MATCH_PROBABILITY = .65
export interface DuelGenerationSettings { maxPartnerMeetings: number | null; maxOpponentMeetings: number | null; maxMatchProbability?: number }
export function duelMatchProbabilityLimit(settings: DuelGenerationSettings): number {
  return settings.maxMatchProbability ?? DEFAULT_MAX_MATCH_PROBABILITY
}
export type DuelOptionKind = 'balance' | 'variety' | 'experience' | 'alternative'
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
  squads: [string[], string[]]; option: DuelScheduleOption
  engine?: 'cp-sat' | 'exhaustive'
}
export interface DuelSearchInput {
  pool: PoolPlayer[]; settings: DuelGenerationSettings; inputKey: string; partnerHistory: string[][]
}
export interface DuelSplit { id: string; squads: [string[], string[]]; bestWorst: number }
export interface DuelSearchCatalog { globalBest: number | null; splits: DuelSplit[] }
export interface DuelSearchProgress { phase: 'bounds' | 'global' | 'eligible' | 'options'; completed: number; total: number; nodes: number }
type Pair = [number, number]
interface Partition { pairs: number[]; bye: number }
interface Round { home: number[]; away: number[]; homeBye: number; awayBye: number; links: number[]; cells: number[]; cost: number; sum: number; tie: number }
type RoundTemplate = Omit<Round, 'cost' | 'sum'>
interface Prepared { squads: [PoolPlayer[], PoolPlayer[]]; rounds: Round[]; probabilities: number[]; edges: Pair[]; size: number; roundCount: number; lower: number }
type Progress = (p: DuelSearchProgress) => void

export function validateDuelSettings(size: number, settings: DuelGenerationSettings): void {
  if (!Number.isInteger(size) || size < 4 || size > 7) throw new Error('DUEL_SIZE')
  for (const value of [settings.maxPartnerMeetings, settings.maxOpponentMeetings]) {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > size - 1)) throw new Error('DUEL_LIMIT_RANGE')
  }
  if (settings.maxOpponentMeetings !== null && size * settings.maxOpponentMeetings < 2 * (size - 1)) throw new Error('DUEL_OPPONENT_LIMIT_IMPOSSIBLE')
  const limit = duelMatchProbabilityLimit(settings)
  if (!Number.isFinite(limit) || limit < .5 || limit > 1) throw new Error('DUEL_MATCH_LIMIT_RANGE')
}

const structures = new Map<number, { edges: Pair[]; templates: RoundTemplate[]; permutations: number[][] }>()
function structure(size: number) {
  const cached = structures.get(size); if (cached) return cached
  const edges: Pair[] = []
  for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) edges.push([a, b])
  const partitions: Partition[] = []
  function pair(rest: number[], pairs: number[], bye: number) {
    if (!rest.length) { partitions.push({ pairs, bye }); return }
    const a = rest[0]!
    for (const b of rest.slice(1)) pair(rest.filter(v => v !== a && v !== b), [...pairs, edges.findIndex(e => e[0] === a && e[1] === b)], bye)
  }
  const all = Array.from({ length: size }, (_, i) => i)
  for (const bye of size % 2 ? all : [-1]) pair(all.filter(i => i !== bye), [], bye)
  const permutations: number[][] = []
  function permute(rest: number[], chosen: number[]) { if (!rest.length) permutations.push(chosen); else for (const i of rest) permute(rest.filter(v => v !== i), [...chosen, i]) }
  permute(Array.from({ length: Math.floor(size / 2) }, (_, i) => i), [])
  // Lineups and their incidence do not depend on ratings or the squad split.
  // Build them once, including the original lexical tie order.
  const templates: (Omit<RoundTemplate, 'tie'> & { key: string })[] = []
  for (const h of partitions) for (const a of partitions) for (const permutation of permutations) {
    const away = permutation.map(i => a.pairs[i]!), cells = h.pairs.map((e, i) => e * edges.length + away[i]!), links: number[] = []
    h.pairs.forEach((e, i) => { for (const x of edges[e]!) for (const y of edges[away[i]!]!) links.push(x * size + y) })
    templates.push({ home: h.pairs, away, homeBye: h.bye, awayBye: a.bye, cells, links, key: cells.join(':') })
  }
  templates.sort((a, b) => a.key.localeCompare(b.key))
  const result = { edges, templates: templates.map(({ key: _key, ...r }, tie) => ({ ...r, tie })), permutations }
  structures.set(size, result); return result
}

function prepare(squads: [PoolPlayer[], PoolPlayer[]], upper: number, settings: DuelGenerationSettings): Prepared {
  upper = Math.min(upper, duelMatchProbabilityLimit(settings))
  const size = squads[0].length, { edges, templates } = structure(size), edgeCount = edges.length
  const skills = squads.map(s => edges.map(e => e.map(i => ({ rating: s[i]!.rating, rd: s[i]!.rating_deviation, volatility: 0 }))))
  const probabilities = skills[0]!.flatMap(h => skills[1]!.map(a => teamWinProbability(h, a)!))
  const costs = probabilities.map(p => Math.max(p, 1 - p)), rounds: Round[] = []
  const partnerCosts = [Array.from({ length: size }, () => Array<number>(size).fill(1)), Array.from({ length: size }, () => Array<number>(size).fill(1))]
  const opponentCosts = Array.from({ length: size }, () => Array<number>(size).fill(1))
  for (let h = 0; h < edgeCount; h++) for (let a = 0; a < edgeCount; a++) {
    const cost = costs[h * edgeCount + a]!, [x, y] = edges[h]!, [u, v] = edges[a]!
    partnerCosts[0]![x]![y] = partnerCosts[0]![y]![x] = Math.min(partnerCosts[0]![x]![y]!, cost)
    partnerCosts[1]![u]![v] = partnerCosts[1]![v]![u] = Math.min(partnerCosts[1]![u]![v]!, cost)
    for (const i of [x, y]) for (const j of [u, v]) opponentCosts[i]![j] = Math.min(opponentCosts[i]![j]!, cost)
  }
  const requiredPartners = Math.ceil((size - 1) / (settings.maxPartnerMeetings ?? size - 1))
  const requiredOpponents = Math.ceil(2 * (size - 1) / (settings.maxOpponentMeetings ?? size - 1))
  const lower = Math.max(...partnerCosts.flatMap(side => side.map((row, i) => row.filter((_, j) => j !== i).sort((a, b) => a - b)[requiredPartners - 1]!)),
    ...opponentCosts.map(row => [...row].sort((a, b) => a - b)[requiredOpponents - 1]!), ...Array.from({ length: size }, (_, i) => opponentCosts.map(row => row[i]!).sort((a, b) => a - b)[requiredOpponents - 1]!))
  if (lower > upper + EPS) return { squads, edges, probabilities, rounds, size, roundCount: size - 1 + size % 2, lower }
  for (const r of templates) {
    let cost = 0, sum = 0
    for (const cell of r.cells) { const value = costs[cell]!; cost = Math.max(cost, value); sum += value }
    if (cost <= upper + EPS) rounds.push({ ...r, cost, sum })
  }
  // A player needs enough distinct choices that can appear in complete rounds,
  // rather than merely in isolated games. This is a necessary bound, not a heuristic.
  const roundPartners = [Array<number>(edgeCount).fill(1), Array<number>(edgeCount).fill(1)]
  const roundOpponents = Array<number>(size * size).fill(1)
  for (const r of rounds) {
    for (const e of r.home) roundPartners[0]![e] = Math.min(roundPartners[0]![e]!, r.cost)
    for (const e of r.away) roundPartners[1]![e] = Math.min(roundPartners[1]![e]!, r.cost)
    for (const link of r.links) roundOpponents[link] = Math.min(roundOpponents[link]!, r.cost)
  }
  const roundLower = Math.max(lower, ...roundPartners.flatMap(side => Array.from({ length: size }, (_, i) => edges.flatMap((e, j) => e.includes(i) ? [side[j]!] : []).sort((a, b) => a - b)[requiredPartners - 1]!)),
    ...Array.from({ length: size }, (_, i) => roundOpponents.slice(i * size, (i + 1) * size).sort((a, b) => a - b)[requiredOpponents - 1]!),
    ...Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => roundOpponents[j * size + i]!).sort((a, b) => a - b)[requiredOpponents - 1]!))
  rounds.sort((a, b) => a.cost - b.cost || a.sum - b.sum || a.tie - b.tie)
  return { squads, edges, probabilities, rounds: roundLower > upper + EPS ? [] : rounds, size, roundCount: size - 1 + size % 2, lower: roundLower }
}

function splitId(squads: [string[], string[]]) { return squads.map(s => [...s].sort().join(':')).join('|') }
function compareRank(a: number[], b: number[]) { for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > EPS) return a[i]! - b[i]!; return 0 }
function enumerate(
  prepared: Prepared, settings: DuelGenerationSettings, upper: number,
  visit: (rounds: Round[], forecast: SeasonForecast) => boolean,
  tick: () => void,
): boolean {
  const { size, edges, probabilities, roundCount } = prepared, rounds = prepared.rounds.filter(r => r.cost <= upper + EPS)
  if (!rounds.length) return false
  const min = Array<number>(Math.floor(size / 2)).fill(Infinity), max = min.map(() => -Infinity)
  for (const r of rounds) {
    const values = r.cells.map(c => probabilities[c]!).sort((a, b) => a - b)
    values.forEach((value, i) => { min[i] = Math.min(min[i]!, value); max[i] = Math.max(max[i]!, value) })
  }
  if (decisiveSeasonChances(forecastSeason(Array.from({ length: roundCount }, () => min).flat()))!.home > .55 + EPS
    || decisiveSeasonChances(forecastSeason(Array.from({ length: roundCount }, () => max).flat()))!.home < .45 - EPS) return false
  // Each bit represents a complete round still compatible with the prefix.
  // When a meeting reaches its cap, remove all rounds containing it at once.
  const edgeCount = edges.length, opponentOffset = 2 * edgeCount, byeOffset = opponentOffset + size * size
  const matchupOffset = byeOffset + (size % 2 ? 2 * size : 0)
  const featureCount = matchupOffset + edges.length ** 2, words = Math.ceil(rounds.length / 32)
  const masks = Array.from({ length: featureCount }, () => new Uint32Array(words))
  const features = rounds.map((r, index) => {
    const ids = [...r.home, ...r.away.map(e => edgeCount + e), ...r.links.map(link => opponentOffset + link), ...r.cells.map(cell => matchupOffset + cell)]
    if (r.homeBye >= 0) ids.push(byeOffset + r.homeBye, byeOffset + size + r.awayBye)
    for (const id of ids) masks[id]![index >>> 5] |= 1 << (index & 31)
    return ids
  })
  const caps = new Uint8Array(featureCount), counts = new Uint8Array(featureCount)
  caps.fill(settings.maxPartnerMeetings ?? size - 1, 0, opponentOffset)
  caps.fill(settings.maxOpponentMeetings ?? size - 1, opponentOffset, byeOffset)
  caps.fill(1, byeOffset)
  const available = Array.from({ length: roundCount }, () => new Uint32Array(words))
  available[0]!.fill(0xffffffff)
  available[0]![words - 1] = 0xffffffff >>> ((32 - rounds.length % 32) % 32)
  const chosen: Round[] = []
  function dfs(depth: number): boolean {
    tick()
    if (depth === roundCount) {
      const forecast = forecastSeason(chosen.flatMap(r => r.cells.map(c => probabilities[c]!)))
      return isSeasonForecastBalanced(forecast) && visit(chosen, forecast)
    }
    const candidates = available[depth]!
    for (let word = 0; word < words; word++) while (candidates[word]) {
      const bit = candidates[word]! & -candidates[word]!, index = word * 32 + 31 - Math.clz32(bit)
      const ids = features[index]!
      for (const id of ids) counts[id] = counts[id]! + 1
      chosen.push(rounds[index]!)
      let possible = true
      if (depth + 1 < roundCount) {
        const next = available[depth + 1]!
        next.set(candidates)
        for (const id of ids) if (counts[id] === caps[id]) {
          const blocked = masks[id]!
          for (let w = word; w < words; w++) next[w] &= ~blocked[w]!
        }
        possible = next.some(bits => bits !== 0)
      }
      const found = possible && dfs(depth + 1)
      chosen.pop()
      for (const id of ids) counts[id] = counts[id]! - 1
      // Matchup features block any later round containing the same four players.
      // Clearing this bit visits each permitted round combination exactly once.
      candidates[word] &= ~bit
      if (found) return true
    }
    return false
  }
  return dfs(0)
}

function bestWorst(p: Prepared, settings: DuelGenerationSettings, upper: number, tick: () => void): number | null {
  const levels = [...new Set(p.rounds.filter(r => r.cost <= upper + EPS && r.cost >= p.lower - EPS).map(r => r.cost))]
  if (!levels.length || !enumerate(p, settings, levels.at(-1)!, () => true, tick)) return null
  let lo = 0, hi = levels.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (enumerate(p, settings, levels[mid]!, () => true, tick)) hi = mid; else lo = mid + 1 }
  return levels[lo]!
}

export function searchDuelSplits(input: DuelSearchInput, progress: Progress = () => {}): DuelSearchCatalog {
  validateLeagueDuelPool(input.pool); validateDuelSettings(input.pool.length / 2, input.settings)
  const pool = [...input.pool].sort(compareDuelPlayers), size = pool.length / 2, splits: [PoolPlayer[], PoolPlayer[]][] = []
  function choose(start: number, indices: number[]) {
    if (indices.length === size) { const set = new Set(indices); splits.push([indices.map(i => pool[i]!), pool.filter((_, i) => !set.has(i))]); return }
    for (let i = start; i <= pool.length - (size - indices.length); i++) choose(i + 1, [...indices, i])
  }
  choose(1, [0])
  // Starting with the strongest necessary bottleneck bound quickly establishes
  // an upper bound without changing which splits or schedules are searched.
  let boundUpdate = 0
  progress({ phase: 'bounds', completed: 0, total: splits.length, nodes: 0 })
  const bounds = new Map(splits.map((s, i) => {
    const lower = prepare(s, duelMatchProbabilityLimit(input.settings), input.settings).lower
    if (Date.now() - boundUpdate >= 200 || i + 1 === splits.length) {
      boundUpdate = Date.now(); progress({ phase: 'bounds', completed: i + 1, total: splits.length, nodes: 0 })
    }
    return [s, lower] as const
  }))
  splits.sort((a, b) => bounds.get(a)! - bounds.get(b)!)
  let globalBest = duelMatchProbabilityLimit(input.settings) + EPS * 2, nodes = 0, last = 0, completed = 0
  let phase: DuelSearchProgress['phase'] = 'global'
  const solved = new Map<[PoolPlayer[], PoolPlayer[]], number>()
  const tick = () => { nodes++; if ((nodes & 1023) === 0 && Date.now() - last >= 200) { last = Date.now(); progress({ phase, completed, total: splits.length, nodes }) } }
  for (const squads of splits) {
    const p = prepare(squads, globalBest - EPS * 2, input.settings)
    const best = bestWorst(p, input.settings, globalBest - EPS * 2, tick)
    if (best !== null) { globalBest = Math.min(globalBest, best); solved.set(squads, best) }
    completed++; progress({ phase, completed, total: splits.length, nodes })
  }
  if (!solved.size) return { globalBest: null, splits: [] }
  phase = 'eligible'; completed = 0
  const eligible: DuelSplit[] = []
  for (const squads of splits) {
    const previous = solved.get(squads)
    let best: number | null
    if (previous !== undefined) best = previous <= globalBest + .05 + EPS ? previous : null
    else {
      const p = prepare(squads, globalBest + .05, input.settings)
      p.lower = Math.max(p.lower, globalBest)
      best = bestWorst(p, input.settings, globalBest + .05, tick)
    }
    if (best !== null) { const ids = squads.map(s => s.map(p => p.id)) as [string[], string[]]; eligible.push({ id: splitId(ids), squads: ids, bestWorst: best }) }
    completed++; progress({ phase, completed, total: splits.length, nodes })
  }
  eligible.sort((a, b) => a.bestWorst - b.bestWorst || a.id.localeCompare(b.id))
  return { globalBest, splits: eligible }
}

/** The same four people count as a repeat regardless of side, partners, or order. */
export function hasUniqueDuelMatchups(games: readonly LeagueDuelGame[]): boolean {
  return new Set(games.map(g => [...g.homePoolPlayerIds, ...g.awayPoolPlayerIds].sort().join(':'))).size === games.length
}

export function duelScheduleId(games: readonly LeagueDuelGame[]): string {
  return games.map(g => [...g.homePoolPlayerIds].sort().join(':') + '/' + [...g.awayPoolPlayerIds].sort().join(':')).sort().join('|')
}

/** Exact feasibility query, also used for offline verification of bottleneck bounds. */
export function findDuelSchedule(squads: [PoolPlayer[], PoolPlayer[]], settings: DuelGenerationSettings, upper: number): LeagueDuelGame[] | null {
  validateLeagueDuelPool(squads.flat()); validateDuelSettings(squads[0].length, settings)
  if (squads[0].length !== squads[1].length || !Number.isFinite(upper) || upper < .5 || upper > 1) throw new Error('DUEL_INVALID_SEARCH')
  const p = prepare(squads, upper, settings)
  let result: LeagueDuelGame[] | null = null
  enumerate(p, settings, upper, rs => {
    result = rs.flatMap((r, index) => r.home.map((h, i) => ({ roundNumber: index + 1, sequenceNumber: 0, homePoolPlayerIds: p.edges[h]!.map(j => squads[0][j]!.id) as [string, string], awayPoolPlayerIds: p.edges[r.away[i]!]!.map(j => squads[1][j]!.id) as [string, string] }))).map((g, i) => ({ ...g, sequenceNumber: i + 1 }))
    return true
  }, () => {})
  return result
}

/** Optimize only order; back-to-back costs depend on the last/first game of adjacent rounds. */
export function orderDuelGames(games: LeagueDuelGame[]): LeagueDuelGame[] {
  const groups = [...new Set(games.map(g => g.roundNumber))].map(r => games.filter(g => g.roundNumber === r))
  const permutations = structure(groups[0]!.length * 2).permutations
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

export function searchDuelOptions(input: DuelSearchInput, split: DuelSplit, excluded: string[] = [], progress: Progress = () => {}): DuelScheduleOption[] {
  validateDuelSettings(input.pool.length / 2, input.settings)
  const pool = new Map(input.pool.map(p => [p.id, p])), squads = split.squads.map(s => s.map(id => pool.get(id)!)) as [PoolPlayer[], PoolPlayer[]]
  const p = prepare(squads, split.bestWorst + .05, input.settings), top: { option: DuelScheduleOption; rank: number[] }[][] = [[], [], []], seen = new Set(excluded)
  let nodes = 0, last = 0
  enumerate(p, input.settings, split.bestWorst + .05, rs => {
    const games: LeagueDuelGame[] = rs.flatMap((r, index) => r.home.map((h, i) => ({ roundNumber: index + 1, sequenceNumber: 0, homePoolPlayerIds: p.edges[h]!.map(j => squads[0][j]!.id) as [string, string], awayPoolPlayerIds: p.edges[r.away[i]!]!.map(j => squads[1][j]!.id) as [string, string] })))
    const id = duelScheduleId(games); if (seen.has(id)) return false
    const m = measureDuelSchedule(squads, games)
    let history = 0
    squads.forEach((s, side) => s.forEach((a, i) => s.slice(i + 1).forEach((b, offset) => { if (m.partnerCounts[side]![i]![i + offset + 1]! > 0) history += input.partnerHistory.reduce((sum, season) => sum + Number(season.includes([a.id, b.id].sort().join(':'))), 0) })))
    const imbalance = m.averageFavorite, worstHard = Math.max(...m.players.map(p => p.below40)), disadvantage = Math.max(...m.players.map(p => p.disadvantage))
    const ranks = [[m.worstFavorite, games.length - m.within60, imbalance, history], [-m.coveredOpponents, -m.usedPartners, m.opponentCounts.flat().reduce((s, n) => s + n * (n - 1) / 2, 0), m.worstFavorite, imbalance, history], [worstHard, disadvantage, m.worstFavorite, imbalance, history]]
    for (let profile = 0; profile < 3; profile++) {
      const entries = top[profile]!, existing = entries.findIndex(e => e.option.id === id)
      const entry = { option: { id, kind: (['balance', 'variety', 'experience'] as const)[profile]!, games, metrics: m }, rank: ranks[profile]! }
      if (existing >= 0) continue
      entries.push(entry); entries.sort((a, b) => compareRank(a.rank, b.rank) || a.option.id.localeCompare(b.option.id)); if (entries.length > 3) entries.pop()
    }
    return false
  }, () => { nodes++; if ((nodes & 1023) === 0 && Date.now() - last > 200) { last = Date.now(); progress({ phase: 'options', completed: 0, total: 1, nodes }) } })
  const result: DuelScheduleOption[] = []
  for (const entries of top) { const entry = entries.find(e => !result.some(r => r.id === e.option.id)); if (entry) result.push(entry.option) }
  const baseline = result[0]?.metrics
  if (baseline && result[2]) {
    const improvement = (m: DuelMetrics) => [Math.max(...m.players.map(p => p.below40)), Math.max(...m.players.map(p => p.disadvantage))]
    if (compareRank(improvement(result[2].metrics), improvement(baseline)) >= 0) result[2].kind = 'alternative'
  }
  for (const option of result) { option.games = orderDuelGames(option.games); option.metrics = measureDuelSchedule(squads, option.games) }
  return result
}

export function selectNextDuelSplit(catalog: DuelSearchCatalog, current: DuelSplit | undefined, seenIds: string[]): DuelSplit | undefined {
  let available = catalog.splits.filter(s => !seenIds.includes(s.id))
  if (!available.length) available = catalog.splits.filter(s => s.id !== current?.id)
  if (!available.length) return current ?? catalog.splits[0]
  const distance = (s: DuelSplit) => { if (!current) return 0; const moved = s.squads[0].filter(id => !current.squads[0].includes(id)).length; return Math.min(moved, s.squads[0].length - moved) }
  return [...available].sort((a, b) => distance(b) - distance(a) || a.bestWorst - b.bestWorst || a.id.localeCompare(b.id))[0]
}
