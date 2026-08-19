import { teamWinProbability, type SkillRating } from './ratings'

export interface RatedPlayerRef {
  id: string
  name: string
  rating: number
  ratingDeviation: number
}

export interface BalancedTeam {
  poolPlayerIds: [string, string]
  playerNames: [string, string]
  teamRating: number
}

export interface BalancedTeamOption {
  id: string
  teams: BalancedTeam[]
  /** Fairness of the least-even matchup: 100 means exactly 50/50. */
  fairnessPercent: number
  repeatedPartnerships: number
}

export interface TeamBalanceSummary {
  fairnessPercent: number
  repeatedPartnerships: number
}

interface ScoredPairing {
  pairs: [RatedPlayerRef, RatedPlayerRef][]
  worstDeviation: number
  averageDeviation: number
  repeatedPartnerships: number
  uncertaintySpread: number
  ratingVariance: number
}

const BETA_DISPLAY = 250

export function partnershipKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function teamStats([a, b]: [RatedPlayerRef, RatedPlayerRef]) {
  return {
    rating: a.rating + b.rating,
    variance: a.ratingDeviation ** 2 + b.ratingDeviation ** 2,
  }
}

function scorePairing(
  pairs: [RatedPlayerRef, RatedPlayerRef][],
  partnershipCounts: ReadonlyMap<string, number>,
): ScoredPairing {
  const teams = pairs.map(teamStats)
  let worstDeviation = 0
  let totalDeviation = 0
  let matchupCount = 0

  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      const a = teams[i]!
      const b = teams[j]!
      const denominator = Math.sqrt(
        4 * BETA_DISPLAY ** 2 + a.variance + b.variance,
      )
      const deviation = Math.abs(a.rating - b.rating) / denominator
      worstDeviation = Math.max(worstDeviation, deviation)
      totalDeviation += deviation
      matchupCount += 1
    }
  }

  const uncertainties = teams.map((team) => Math.sqrt(team.variance))
  const ratings = teams.map((team) => team.rating)
  const mean = ratings.reduce((sum, value) => sum + value, 0) / ratings.length

  return {
    pairs,
    worstDeviation,
    averageDeviation: matchupCount > 0 ? totalDeviation / matchupCount : 0,
    repeatedPartnerships: pairs.reduce(
      (sum, [a, b]) => sum + (partnershipCounts.get(partnershipKey(a.id, b.id)) ?? 0),
      0,
    ),
    uncertaintySpread: Math.max(...uncertainties) - Math.min(...uncertainties),
    ratingVariance:
      ratings.reduce((sum, rating) => sum + (rating - mean) ** 2, 0) / ratings.length,
  }
}

function comparePairings(a: ScoredPairing, b: ScoredPairing): number {
  return (
    a.worstDeviation - b.worstDeviation ||
    a.averageDeviation - b.averageDeviation ||
    a.repeatedPartnerships - b.repeatedPartnerships ||
    a.uncertaintySpread - b.uncertaintySpread ||
    a.ratingVariance - b.ratingVariance ||
    pairingId(a.pairs).localeCompare(pairingId(b.pairs))
  )
}

function pairingId(pairs: [RatedPlayerRef, RatedPlayerRef][]): string {
  return pairs
    .map(([a, b]) => partnershipKey(a.id, b.id))
    .sort()
    .join('|')
}

function insertCandidate(candidates: ScoredPairing[], candidate: ScoredPairing, limit: number) {
  if (candidates.some((existing) => pairingId(existing.pairs) === pairingId(candidate.pairs))) {
    return
  }
  candidates.push(candidate)
  candidates.sort(comparePairings)
  if (candidates.length > limit) candidates.pop()
}

function snakeDraftPairs(players: RatedPlayerRef[]): [RatedPlayerRef, RatedPlayerRef][] {
  const sorted = [...players].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
  return Array.from({ length: sorted.length / 2 }, (_, index) => [
    sorted[index]!,
    sorted[sorted.length - 1 - index]!,
  ])
}

function search(
  remaining: RatedPlayerRef[],
  pairs: [RatedPlayerRef, RatedPlayerRef][],
  onCandidate: (pairs: [RatedPlayerRef, RatedPlayerRef][]) => void,
) {
  if (remaining.length === 0) {
    onCandidate(pairs)
    return
  }
  const first = remaining[0]!
  for (let i = 1; i < remaining.length; i += 1) {
    search(
      remaining.filter((_, index) => index !== 0 && index !== i),
      [...pairs, [first, remaining[i]!]],
      onCandidate,
    )
  }
}

function toBalancedTeam([a, b]: [RatedPlayerRef, RatedPlayerRef]): BalancedTeam {
  return {
    poolPlayerIds: [a.id, b.id],
    playerNames: [a.name, b.name],
    teamRating: a.rating + b.rating,
  }
}

function fairnessPercent(pairs: [RatedPlayerRef, RatedPlayerRef][]): number {
  let worstProbability = 0.5
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      const toSkill = (player: RatedPlayerRef): SkillRating => ({
        rating: player.rating,
        rd: player.ratingDeviation,
        volatility: 0,
      })
      const probability = teamWinProbability(
        pairs[i]!.map(toSkill),
        pairs[j]!.map(toSkill),
      ) ?? 0.5
      if (Math.abs(probability - 0.5) > Math.abs(worstProbability - 0.5)) {
        worstProbability = probability
      }
    }
  }
  return Math.round((1 - 2 * Math.abs(worstProbability - 0.5)) * 100)
}

/** Generate the strongest distinct options for projected round-robin match fairness. */
export function generateBalancedTeamOptions(
  players: RatedPlayerRef[],
  partnershipCounts: ReadonlyMap<string, number> = new Map(),
  optionCount = 3,
): BalancedTeamOption[] {
  if (players.length < 2) throw new Error('Need at least 2 players')
  if (players.length % 2 !== 0) throw new Error('Need an even number of players')

  const candidates: ScoredPairing[] = []
  insertCandidate(candidates, scorePairing(snakeDraftPairs(players), partnershipCounts), optionCount)

  if (players.length <= 14) {
    search(players, [], (pairs) => {
      insertCandidate(candidates, scorePairing(pairs, partnershipCounts), optionCount)
    })
  } else {
    const base = snakeDraftPairs(players)
    for (let i = 0; i < base.length; i += 1) {
      for (let j = i + 1; j < base.length; j += 1) {
        const alternative = base.map((pair) => [...pair] as [RatedPlayerRef, RatedPlayerRef])
        const partner = alternative[i]![1]
        alternative[i]![1] = alternative[j]![1]
        alternative[j]![1] = partner
        insertCandidate(
          candidates,
          scorePairing(alternative, partnershipCounts),
          optionCount,
        )
      }
    }
  }

  return candidates.map((candidate) => ({
    id: pairingId(candidate.pairs),
    teams: candidate.pairs
      .map(toBalancedTeam)
      .sort((a, b) => b.teamRating - a.teamRating),
    fairnessPercent: fairnessPercent(candidate.pairs),
    repeatedPartnerships: candidate.repeatedPartnerships,
  }))
}

export function evaluateBalancedTeams(
  teams: BalancedTeam[],
  players: RatedPlayerRef[],
  partnershipCounts: ReadonlyMap<string, number> = new Map(),
): TeamBalanceSummary {
  const byId = new Map(players.map((player) => [player.id, player]))
  const pairs = teams.map((team): [RatedPlayerRef, RatedPlayerRef] => {
    const first = byId.get(team.poolPlayerIds[0])
    const second = byId.get(team.poolPlayerIds[1])
    if (!first || !second) throw new Error('Team contains an unknown player')
    return [first, second]
  })
  const score = scorePairing(pairs, partnershipCounts)
  return {
    fairnessPercent: fairnessPercent(pairs),
    repeatedPartnerships: score.repeatedPartnerships,
  }
}

/** Backward-compatible single best option. */
export function generateBalancedTeams(players: RatedPlayerRef[]): BalancedTeam[] {
  return generateBalancedTeamOptions(players)[0]!.teams
}
