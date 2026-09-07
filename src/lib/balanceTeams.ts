export interface RatedPlayerRef {
  id: string
  name: string
  rating: number
}

export interface BalancedTeam {
  poolPlayerIds: [string, string]
  playerNames: [string, string]
  teamRating: number
}

export interface BalancedTeamOption {
  id: string
  teams: BalancedTeam[]
  /** Weakest team rating as a percentage of the strongest; 100 means equal. */
  fairnessPercent: number
  repeatedPartnerships: number
}

export interface TeamBalanceSummary {
  fairnessPercent: number
  repeatedPartnerships: number
}

interface ScoredPairing {
  pairs: [RatedPlayerRef, RatedPlayerRef][]
  ratingSpread: number
  averageRatingGap: number
  repeatedPartnerships: number
  ratingVariance: number
}

export function partnershipKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function teamStats([a, b]: [RatedPlayerRef, RatedPlayerRef]) {
  return a.rating + b.rating
}

function scorePairing(
  pairs: [RatedPlayerRef, RatedPlayerRef][],
  partnershipCounts: ReadonlyMap<string, number>,
): ScoredPairing {
  const teams = pairs.map(teamStats)
  let ratingSpread = 0
  let totalRatingGap = 0
  let matchupCount = 0

  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      const gap = Math.abs(teams[i]! - teams[j]!)
      ratingSpread = Math.max(ratingSpread, gap)
      totalRatingGap += gap
      matchupCount += 1
    }
  }

  const mean = teams.reduce((sum, value) => sum + value, 0) / teams.length

  return {
    pairs,
    ratingSpread,
    averageRatingGap: matchupCount > 0 ? totalRatingGap / matchupCount : 0,
    repeatedPartnerships: pairs.reduce(
      (sum, [a, b]) => sum + (partnershipCounts.get(partnershipKey(a.id, b.id)) ?? 0),
      0,
    ),
    ratingVariance:
      teams.reduce((sum, rating) => sum + (rating - mean) ** 2, 0) / teams.length,
  }
}

function comparePairings(a: ScoredPairing, b: ScoredPairing): number {
  return (
    a.ratingSpread - b.ratingSpread ||
    a.averageRatingGap - b.averageRatingGap ||
    a.repeatedPartnerships - b.repeatedPartnerships ||
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
  const teamRatings = pairs.map(teamStats)
  const strongest = Math.max(...teamRatings)
  const weakest = Math.min(...teamRatings)
  if (strongest <= 0) return 100
  return Math.round((weakest / strongest) * 100)
}

/** Generate the strongest distinct options by team-rating balance. */
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
