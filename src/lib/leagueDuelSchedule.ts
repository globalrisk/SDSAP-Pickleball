import type { DuelDraftPriority, DuelTier, PoolPlayer } from '../types'
import { teamWinProbability } from './ratings'
import { generateLeagueTeamDuelSchedule } from './teamDuelSchedule'
import { forecastSeason, seasonForecastImbalance, type SeasonForecast } from './seasonForecast'

export const LEAGUE_DUEL_ROSTER_SIZES = [8, 10, 12, 14] as const
type Pair = readonly [number, number]

export interface LeagueDuelGame {
  roundNumber: number
  sequenceNumber: number
  homePoolPlayerIds: [string, string]
  awayPoolPlayerIds: [string, string]
}

export interface LeagueDuelSchedule {
  games: LeagueDuelGame[]
  worstFavorite: number
  totalImbalance: number
  opponentRepeats: number
  /** Cross-squad encounter counts, highest first, including pairs that never meet. */
  opponentEncounterCounts: number[]
  seasonForecast: SeasonForecast
}

export function compareDuelPlayers(a: PoolPlayer, b: PoolPlayer): number {
  return b.rating - a.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function validateLeagueDuelPool(pool: readonly PoolPlayer[]): void {
  if (!(LEAGUE_DUEL_ROSTER_SIZES as readonly number[]).includes(pool.length)) {
    throw new Error('Select 8, 10, 12, or 14 players for Team Duel.')
  }
  if (new Set(pool.map((p) => p.id)).size !== pool.length
    || pool.some((p) => p.status !== 'active' || !Number.isFinite(p.rating)
      || !Number.isFinite(p.rating_deviation) || p.rating_deviation < 0)) {
    throw new Error('Team Duel requires distinct active players with valid ratings.')
  }
}

export function duelTierCounts(size: number): [number, number, number] {
  if (!Number.isInteger(size) || size < 4 || size > 7) throw new Error('Squads must have 4–7 players.')
  const edge = Math.floor(size / 3)
  return [edge, size - edge * 2, edge]
}

export function duelTierForRank(rank: number, size: number): DuelTier {
  const [top, middle] = duelTierCounts(size)
  return rank <= top ? 'top' : rank <= top + middle ? 'middle' : 'bottom'
}

/** Tight feasible tier limits for complete partnerships and conflict-free rounds. */
export function duelOpponentMeetingCaps(size: number): Record<DuelTier, number> {
  const [top, middle, bottom] = duelTierCounts(size)
  // Each player has size + tierSize - 2 encounters with their own tier.
  const cap = (tierSize: number) => Math.ceil((size + tierSize - 2) / tierSize)
  // For sizes 4 and 5, a middle limit of 2 cannot cover every partnership
  // while keeping rounds conflict-free. Exhaustive reference tests prove this.
  return { top: cap(top), middle: Math.max(3, cap(middle)), bottom: cap(bottom) }
}

export function assignLeagueDuelTiers(pool: readonly PoolPlayer[]): Map<string, DuelTier> {
  validateLeagueDuelPool(pool)
  const [top, middle] = duelTierCounts(pool.length / 2)
  return new Map([...pool].sort(compareDuelPlayers).map((player, index) =>
    [player.id, index < top * 2 ? 'top' : index < (top + middle) * 2 ? 'middle' : 'bottom']))
}

/** Minimize the worst repetition, then the next worst, before considering balance. */
export function compareOpponentEncounters(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const difference = a[i]! - b[i]!
    if (difference) return difference
  }
  return 0
}

interface Candidate { awayPairs: Pair[]; opponentRepeats: number; opponentEncounterCounts: number[] }
interface Patterns { homePairs: Pair[]; roundNumbers: number[]; candidates: Candidate[] }
const patternCache = new Map<number, Patterns>()

/** Every candidate covers both complete partnership graphs and conflict-free rounds. */
function schedulePatterns(size: number): Patterns {
  const cached = patternCache.get(size)
  if (cached) return cached
  const rounds = generateLeagueTeamDuelSchedule(size).map((round) => round.matches
    .map((game): Pair => [...game.rankPair].sort((a, b) => a - b).map((rank) => rank - 1) as [number, number]))
  const homePairs = rounds.flat()
  const roundNumbers = rounds.flatMap((pairs, index) => pairs.map(() => index + 1))
  const tierKey = (pair: Pair) => pair.map((rank) => duelTierForRank(rank + 1, size)).sort().join(':')
  const edges: Pair[] = []
  for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) edges.push([a, b])
  // Enumerate every compatible away round, rather than only relabeling a second
  // circle schedule. At most 21 edges fit in a bit mask for the supported sizes.
  const options = rounds.map((home) => {
    const result: { edgeMask: number; pairs: Pair[] }[] = []
    function visit(game: number, players: number, edgeMask: number, pairs: Pair[]) {
      if (game === home.length) { result.push({ edgeMask, pairs }); return }
      edges.forEach((pair, edge) => {
        const playerMask = (1 << pair[0]) | (1 << pair[1])
        if (!(players & playerMask) && tierKey(pair) === tierKey(home[game]!)) {
          visit(game + 1, players | playerMask, edgeMask | (1 << edge), [...pairs, pair])
        }
      })
    }
    visit(0, 0, 0, [])
    return result
  })
  const candidates: Candidate[] = []
  const caps = duelOpponentMeetingCaps(size)
  const rankCaps = Array.from({ length: size }, (_, rank) => caps[duelTierForRank(rank + 1, size)])
  const opponents = Array<number>(size * size).fill(0)
  function visit(roundIndex: number, usedEdges: number, assigned: Pair[]) {
    if (roundIndex === rounds.length) {
      // A pair must satisfy both players' tier limits, including cross-tier pairs.
      if (opponents.some((count, index) => count > Math.min(rankCaps[Math.floor(index / size)]!, rankCaps[index % size]!))) return
      const opponentEncounterCounts = [...opponents].sort((a, b) => b - a)
      candidates.push({ awayPairs: assigned, opponentEncounterCounts,
        opponentRepeats: opponents.reduce((sum, n) => sum + n * (n - 1) / 2, 0) })
      return
    }
    for (const option of options[roundIndex]!) {
      if (usedEdges & option.edgeMask) continue
      const home = rounds[roundIndex]!
      const update = (delta: number) => option.pairs.forEach((pair, i) => {
        for (const h of home[i]!) for (const a of pair) opponents[h * size + a]! += delta
      })
      update(1)
      visit(roundIndex + 1, usedEdges | option.edgeMask, [...assigned, ...option.pairs])
      update(-1)
    }
  }
  visit(0, 0, [])
  // Visit the fairest patterns first. This also avoids repeatedly building tie
  // identifiers for inferior profiles when every player has the same rating.
  candidates.sort((a, b) => compareOpponentEncounters(a.opponentEncounterCounts, b.opponentEncounterCounts))
  const patterns = { homePairs, roundNumbers, candidates }
  patternCache.set(size, patterns)
  return patterns
}

export function buildTierMatchedDuelSchedules(input: readonly [readonly PoolPlayer[], readonly PoolPlayer[]]): Record<DuelDraftPriority, LeagueDuelSchedule> {
  const pool = input.flat()
  const tiers = assignLeagueDuelTiers(pool)
  const size = pool.length / 2
  const squads = input.map((squad) => [...squad].sort(compareDuelPlayers))
  if (squads.some((squad) => squad.length !== size
    || squad.some((player, rank) => tiers.get(player.id) !== duelTierForRank(rank + 1, size)))) {
    throw new Error('Both squads must have equal top, middle, and bottom tier composition.')
  }
  const patterns = schedulePatterns(size)
  const awayEdges: Pair[] = []
  for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) awayEdges.push([a, b])
  const edgeIndex = (pair: Pair) => pair[0] * size + pair[1]
  const probabilities = patterns.homePairs.map((home) => {
    const values = Array<number>(size * size).fill(0)
    for (const away of awayEdges) {
      if (home.map((r) => duelTierForRank(r + 1, size)).sort().join(':')
        !== away.map((r) => duelTierForRank(r + 1, size)).sort().join(':')) continue
      const skill = (side: number, pair: Pair) => pair.map((rank) => {
        const p = squads[side]![rank]!
        return { rating: p.rating, rd: p.rating_deviation, volatility: 0 }
      })
      const probability = teamWinProbability(skill(0, home), skill(1, away))!
      values[edgeIndex(away)] = probability
    }
    return values
  })
  const candidateId = (candidate: Candidate) => candidate.awayPairs.map((pair) =>
    pair.map((rank) => squads[1]![rank]!.id).sort().join(':')).join('|')
  type Scored = { candidate: Candidate; worst: number; imbalance: number; forecast?: SeasonForecast }
  const forecast = (scored: Scored) => scored.forecast ??= forecastSeason(scored.candidate.awayPairs.map((away, i) => probabilities[i]![edgeIndex(away)]!))
  const best: Partial<Record<DuelDraftPriority, Scored>> = {}
  for (const candidate of patterns.candidates) {
    let worst = 0.5, imbalance = 0
    candidate.awayPairs.forEach((away, i) => {
      const probability = probabilities[i]![edgeIndex(away)]!
      const value = Math.round(Math.max(probability, 1 - probability) * 1e12) / 1e12
      worst = Math.max(worst, value)
      imbalance += value - 0.5
    })
    imbalance = Math.round(imbalance * 1e12) / 1e12
    const scored: Scored = { candidate, worst, imbalance }
    for (const priority of ['balance', 'opponent_variety'] as const) {
      const previous = best[priority]
      const variety = previous ? compareOpponentEncounters(candidate.opponentEncounterCounts, previous.candidate.opponentEncounterCounts) : 0
      const balance = previous ? worst - previous.worst || imbalance - previous.imbalance : 0
      // Only evaluate the full distribution for contenders in the main ranking.
      const seasonBalance = () => previous ? seasonForecastImbalance(forecast(scored)) - seasonForecastImbalance(forecast(previous)) : 0
      const comparison = !previous ? -1 : (priority === 'balance' ? balance || seasonBalance() || variety : variety || seasonBalance() || balance)
        || candidateId(candidate).localeCompare(candidateId(previous.candidate))
      if (comparison < 0) best[priority] = scored
    }
  }
  const schedule = (priority: DuelDraftPriority): LeagueDuelSchedule => {
    const selected = best[priority]
    if (!selected) throw new Error('No valid tier-matched schedule was found.')
    return {
      games: patterns.homePairs.map((home, i) => ({
        roundNumber: patterns.roundNumbers[i]!, sequenceNumber: i + 1,
        homePoolPlayerIds: home.map((rank) => squads[0]![rank]!.id) as [string, string],
        awayPoolPlayerIds: selected.candidate.awayPairs[i]!.map((rank) => squads[1]![rank]!.id) as [string, string],
      })),
      worstFavorite: selected.worst, totalImbalance: selected.imbalance,
      opponentRepeats: selected.candidate.opponentRepeats,
      opponentEncounterCounts: [...selected.candidate.opponentEncounterCounts],
      seasonForecast: forecast(selected),
    }
  }
  return { balance: schedule('balance'), opponent_variety: schedule('opponent_variety') }
}

export function buildTierMatchedDuelSchedule(
  input: readonly [readonly PoolPlayer[], readonly PoolPlayer[]], priority: DuelDraftPriority = 'opponent_variety',
): LeagueDuelSchedule {
  return buildTierMatchedDuelSchedules(input)[priority]
}
