export interface RatedPlayerRef {
  id: string
  name: string
  rating: number
}

export interface BalancedTeam {
  poolPlayerIds: [string, string]
  playerNames: [string, string]
  /** Sum of the two player ratings (team strength). */
  teamRating: number
}

interface ScoredPairing {
  pairs: [RatedPlayerRef, RatedPlayerRef][]
  spread: number
  variance: number
}

/**
 * Partition an even-sized player list into doubles teams that are as equal
 * in combined rating as possible (minimizes max−min team sum, then variance).
 *
 * Exhaustive search is fine for league sizes (≤14 players).
 */
export function generateBalancedTeams(players: RatedPlayerRef[]): BalancedTeam[] {
  if (players.length < 2) {
    throw new Error('Need at least 2 players')
  }
  if (players.length % 2 !== 0) {
    throw new Error('Need an even number of players')
  }

  const best = findBestPairing(players)
  const teams: BalancedTeam[] = best.pairs.map(([a, b]) => ({
    poolPlayerIds: [a.id, b.id],
    playerNames: [a.name, b.name],
    teamRating: a.rating + b.rating,
  }))

  // Strongest combined team first for stable Team 1… naming
  teams.sort((x, y) => y.teamRating - x.teamRating)
  return teams
}

function pairSum(a: RatedPlayerRef, b: RatedPlayerRef): number {
  return a.rating + b.rating
}

function scorePairing(pairs: [RatedPlayerRef, RatedPlayerRef][]): ScoredPairing {
  const sums = pairs.map(([a, b]) => pairSum(a, b))
  const min = Math.min(...sums)
  const max = Math.max(...sums)
  const mean = sums.reduce((s, n) => s + n, 0) / sums.length
  const variance =
    sums.reduce((s, n) => s + (n - mean) ** 2, 0) / Math.max(sums.length, 1)

  return { pairs, spread: max - min, variance }
}

function isBetter(candidate: ScoredPairing, current: ScoredPairing | null): boolean {
  if (!current) return true
  if (candidate.spread !== current.spread) return candidate.spread < current.spread
  return candidate.variance < current.variance
}

function findBestPairing(players: RatedPlayerRef[]): ScoredPairing {
  // Prefer snake draft as initial candidate (strong + weak pairs).
  let best: ScoredPairing | null = scorePairing(snakeDraftPairs(players))

  // Exhaustive search is fine for typical league sizes; fall back above that.
  if (players.length <= 14) {
    const remaining = [...players]
    search(remaining, [], (candidate) => {
      if (isBetter(candidate, best)) {
        best = candidate
      }
    })
  }

  return best!
}

/** Classic strong↔weak pairing — usually near-optimal for balance. */
function snakeDraftPairs(
  players: RatedPlayerRef[],
): [RatedPlayerRef, RatedPlayerRef][] {
  const sorted = [...players].sort((a, b) => b.rating - a.rating)
  const pairs: [RatedPlayerRef, RatedPlayerRef][] = []
  let left = 0
  let right = sorted.length - 1
  while (left < right) {
    pairs.push([sorted[left]!, sorted[right]!])
    left += 1
    right -= 1
  }
  return pairs
}

function search(
  remaining: RatedPlayerRef[],
  pairs: [RatedPlayerRef, RatedPlayerRef][],
  onCandidate: (scored: ScoredPairing) => void,
): void {
  if (remaining.length === 0) {
    onCandidate(scorePairing(pairs))
    return
  }

  const first = remaining[0]!
  for (let i = 1; i < remaining.length; i++) {
    const partner = remaining[i]!
    const nextRemaining = remaining.filter((_, index) => index !== 0 && index !== i)
    search(nextRemaining, [...pairs, [first, partner]], onCandidate)
  }
}
