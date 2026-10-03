import type { DuelTier, PoolPlayer } from '../types'
import { teamWinProbability } from './ratings'
import { generateLeagueTeamDuelSchedule } from './teamDuelSchedule'

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

export function assignLeagueDuelTiers(pool: readonly PoolPlayer[]): Map<string, DuelTier> {
  validateLeagueDuelPool(pool)
  const [top, middle] = duelTierCounts(pool.length / 2)
  return new Map([...pool].sort(compareDuelPlayers).map((player, index) =>
    [player.id, index < top * 2 ? 'top' : index < (top + middle) * 2 ? 'middle' : 'bottom']))
}

function permutations<T>(items: readonly T[]): T[][] {
  if (!items.length) return [[]]
  return items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index))
    .map((rest) => [item, ...rest]))
}

interface Candidate { awayPairs: Pair[]; opponentRepeats: number }
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
  const signature = (pairs: readonly Pair[]) => pairs.map(tierKey).sort().join('|')
  const signatures = rounds.map(signature)
  const counts = duelTierCounts(size)
  let offset = 0
  const bands = counts.map((count) => {
    const band = Array.from({ length: count }, (_, i) => offset + i)
    offset += count
    return permutations(band)
  })
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  for (const top of bands[0]!) for (const middle of bands[1]!) for (const bottom of bands[2]!) {
    const ranks = [...top, ...middle, ...bottom]
    const awayRounds = rounds.map((pairs) => pairs.map((pair): Pair =>
      pair.map((rank) => ranks[rank]!).sort((a, b) => a - b) as [number, number]))
    const options = rounds.map((pairs, roundIndex) => awayRounds.flatMap((away, index) => {
      if (signature(away) !== signatures[roundIndex]) return []
      return permutations(away).filter((ordered) => ordered.every((pair, i) => tierKey(pair) === tierKey(pairs[i]!)))
        .map((ordered) => ({ index, pairs: ordered }))
    }))
    function visit(roundIndex: number, used: number, assigned: Pair[]) {
      if (roundIndex === rounds.length) {
        const key = assigned.map((pair) => pair.join(':')).join('|')
        if (seen.has(key)) return
        seen.add(key)
        const opponents = Array.from({ length: size }, () => Array<number>(size).fill(0))
        assigned.forEach((pair, i) => {
          for (const home of homePairs[i]!) for (const away of pair) opponents[home]![away]!++
        })
        candidates.push({ awayPairs: assigned, opponentRepeats: opponents.flat().reduce((sum, n) => sum + n * (n - 1) / 2, 0) })
        return
      }
      for (const option of options[roundIndex]!) {
        if (!(used & (1 << option.index))) visit(roundIndex + 1, used | (1 << option.index), [...assigned, ...option.pairs])
      }
    }
    visit(0, 0, [])
  }
  const patterns = { homePairs, roundNumbers, candidates }
  patternCache.set(size, patterns)
  return patterns
}

export function buildTierMatchedDuelSchedule(input: readonly [readonly PoolPlayer[], readonly PoolPlayer[]]): LeagueDuelSchedule {
  const pool = input.flat()
  const tiers = assignLeagueDuelTiers(pool)
  const size = pool.length / 2
  const squads = input.map((squad) => [...squad].sort(compareDuelPlayers))
  if (squads.some((squad) => squad.length !== size
    || squad.some((player, rank) => tiers.get(player.id) !== duelTierForRank(rank + 1, size)))) {
    throw new Error('Both squads must have equal top, middle, and bottom tier composition.')
  }
  const patterns = schedulePatterns(size)
  const favorites = new Map<string, number>()
  const favorite = (home: Pair, away: Pair) => {
    const key = `${home.join(':')}|${away.join(':')}`
    const cached = favorites.get(key)
    if (cached !== undefined) return cached
    const skill = (side: number, pair: Pair) => pair.map((rank) => {
      const p = squads[side]![rank]!
      return { rating: p.rating, rd: p.rating_deviation, volatility: 0 }
    })
    const probability = teamWinProbability(skill(0, home), skill(1, away))!
    const value = Math.round(Math.max(probability, 1 - probability) * 1e12) / 1e12
    favorites.set(key, value)
    return value
  }
  const candidateId = (candidate: Candidate) => candidate.awayPairs.map((pair) =>
    pair.map((rank) => squads[1]![rank]!.id).sort().join(':')).join('|')
  let best: { candidate: Candidate; worst: number; imbalance: number } | undefined
  for (const candidate of patterns.candidates) {
    let worst = 0.5, imbalance = 0
    candidate.awayPairs.forEach((away, i) => {
      const value = favorite(patterns.homePairs[i]!, away)
      worst = Math.max(worst, value)
      imbalance += value - 0.5
    })
    imbalance = Math.round(imbalance * 1e12) / 1e12
    const comparison = !best ? -1 : candidate.opponentRepeats - best.candidate.opponentRepeats
      || worst - best.worst
      || imbalance - best.imbalance
      || candidateId(candidate).localeCompare(candidateId(best.candidate))
    if (comparison < 0) best = { candidate, worst, imbalance }
  }
  if (!best) throw new Error('No valid tier-matched schedule was found.')
  return {
    games: patterns.homePairs.map((home, i) => ({
      roundNumber: patterns.roundNumbers[i]!, sequenceNumber: i + 1,
      homePoolPlayerIds: home.map((rank) => squads[0]![rank]!.id) as [string, string],
      awayPoolPlayerIds: best.candidate.awayPairs[i]!.map((rank) => squads[1]![rank]!.id) as [string, string],
    })),
    worstFavorite: best.worst, totalImbalance: best.imbalance,
    opponentRepeats: best.candidate.opponentRepeats,
  }
}
