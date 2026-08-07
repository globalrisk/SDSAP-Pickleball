import { Rating, rate, winProbability } from 'ts-trueskill'
import type { PlayerRankingRow } from '../types'

/**
 * Display scale so TrueSkill mu=25 maps to familiar ~1500 rating points.
 * Stored DB columns stay in this display space (rating ≈ mu * SCALE).
 */
export const TRUESKILL_SCALE = 60

/** Default TrueSkill mu (maps to 1500 display). */
export const TRUESKILL_MU = 25

/** Default TrueSkill sigma (25/3); maps to ~500 display RD. */
export const TRUESKILL_SIGMA = 25 / 3

/**
 * Slightly tighter start sigma for seeded players so ordinal rankings
 * aren't all near zero before anyone plays.
 */
export const INITIAL_SIGMA = TRUESKILL_SIGMA * 0.55

/** Dynamics factor for within-season sit-outs (TrueSkill tau ≈ sigma/100). */
const TAU = TRUESKILL_SIGMA / 100

/** Flat RD added per season a known player is absent from the roster. */
export const SKIP_SEASON_RD_BOOST = 75

/** Cap after skip-season RD boosts (full TrueSkill prior ≈ 500). */
export const SKIP_SEASON_RD_CAP = TRUESKILL_SIGMA * TRUESKILL_SCALE

export interface SkillRating {
  /** Display-scaled TrueSkill mu */
  rating: number
  /** Display-scaled TrueSkill sigma */
  rd: number
  /** Unused by TrueSkill; kept for DB column compatibility */
  volatility: number
}

export const TRUESKILL_DEFAULTS: SkillRating = {
  rating: TRUESKILL_MU * TRUESKILL_SCALE,
  rd: INITIAL_SIGMA * TRUESKILL_SCALE,
  volatility: 0,
}

export interface DoublesMatchPlayers {
  winnerPoolIds: [string, string]
  loserPoolIds: [string, string]
  winnerScore?: number | null
  loserScore?: number | null
  matchId?: string
}

export interface RatingHistoryEntry {
  poolPlayerId: string
  matchId: string | null
  rating: number
  ratingDeviation: number
}

function toTrueSkill(rating: SkillRating): Rating {
  return new Rating(rating.rating / TRUESKILL_SCALE, rating.rd / TRUESKILL_SCALE)
}

function fromTrueSkill(rating: Rating): SkillRating {
  return {
    rating: rating.mu * TRUESKILL_SCALE,
    rd: rating.sigma * TRUESKILL_SCALE,
    volatility: 0,
  }
}

export function createDefaultRatingsMap(poolIds: string[]): Map<string, SkillRating> {
  const map = new Map<string, SkillRating>()
  for (const id of poolIds) {
    map.set(id, { ...TRUESKILL_DEFAULTS })
  }
  return map
}

export function createInitialRatingsMap(
  pool: { id: string; initial_rating: number }[],
): Map<string, SkillRating> {
  const map = new Map<string, SkillRating>()
  for (const player of pool) {
    map.set(player.id, {
      rating: player.initial_rating,
      rd: INITIAL_SIGMA * TRUESKILL_SCALE,
      volatility: 0,
    })
  }
  return map
}

/**
 * Update four players after a doubles match using TrueSkill team rating.
 * Partner strength is modeled — a strong partner carries less individual credit.
 */
export function applyDoublesMatchToRatings(
  ratings: Map<string, SkillRating>,
  match: DoublesMatchPlayers,
): void {
  const { winnerPoolIds, loserPoolIds } = match
  const participantIds = [...winnerPoolIds, ...loserPoolIds]

  for (const id of participantIds) {
    if (!ratings.has(id)) {
      ratings.set(id, { ...TRUESKILL_DEFAULTS })
    }
  }

  const winners = winnerPoolIds.map((id) => toTrueSkill(ratings.get(id)!))
  const losers = loserPoolIds.map((id) => toTrueSkill(ratings.get(id)!))

  const [newWinners, newLosers] = rate([winners, losers])

  winnerPoolIds.forEach((id, index) => {
    ratings.set(id, fromTrueSkill(newWinners[index]!))
  })
  loserPoolIds.forEach((id, index) => {
    ratings.set(id, fromTrueSkill(newLosers[index]!))
  })
}

/** Increase sigma for players who sat out a rating period (round). */
export function applyInactivityToPlayers(
  ratings: Map<string, SkillRating>,
  playerIds: Iterable<string>,
): void {
  const tauDisplay = TAU * TRUESKILL_SCALE
  for (const playerId of playerIds) {
    const current = ratings.get(playerId)
    if (!current) continue
    ratings.set(playerId, {
      ...current,
      rd: Math.sqrt(current.rd * current.rd + tauDisplay * tauDisplay),
    })
  }
}

/**
 * Boost RD for players who skip a season (not on that season's roster).
 * Flat +SKIP_SEASON_RD_BOOST per season, capped at SKIP_SEASON_RD_CAP.
 */
export function applySkipSeasonRdBoost(
  ratings: Map<string, SkillRating>,
  playerIds: Iterable<string>,
): string[] {
  const boosted: string[] = []
  for (const playerId of playerIds) {
    const current = ratings.get(playerId)
    if (!current) continue
    const nextRd = Math.min(SKIP_SEASON_RD_CAP, current.rd + SKIP_SEASON_RD_BOOST)
    if (nextRd === current.rd) continue
    ratings.set(playerId, { ...current, rd: nextRd })
    boosted.push(playerId)
  }
  return boosted
}

/**
 * Apply all completed matches in one round.
 * Matches are rated from a shared pre-round snapshot (simultaneous round).
 * Non-participants get sigma inflation.
 */
export function applyRatingPeriod(
  ratings: Map<string, SkillRating>,
  matches: DoublesMatchPlayers[],
  seasonPoolIds: string[],
  onMatchRated?: (
    match: DoublesMatchPlayers,
    participantRatings: Map<string, SkillRating>,
  ) => void,
): void {
  if (matches.length === 0) {
    applyInactivityToPlayers(ratings, seasonPoolIds)
    return
  }

  const snapshots = new Map<string, SkillRating>()
  for (const id of seasonPoolIds) {
    const current = ratings.get(id) ?? { ...TRUESKILL_DEFAULTS }
    snapshots.set(id, { ...current })
    if (!ratings.has(id)) {
      ratings.set(id, { ...current })
    }
  }

  for (const match of matches) {
    for (const id of [...match.winnerPoolIds, ...match.loserPoolIds]) {
      if (!snapshots.has(id)) {
        const current = ratings.get(id) ?? { ...TRUESKILL_DEFAULTS }
        snapshots.set(id, { ...current })
      }
    }
  }

  const participants = new Set<string>()
  const working = new Map(snapshots)

  for (const match of matches) {
    const local = new Map(snapshots)
    applyDoublesMatchToRatings(local, match)
    const participantRatings = new Map<string, SkillRating>()
    for (const id of [...match.winnerPoolIds, ...match.loserPoolIds]) {
      participants.add(id)
      const updated = local.get(id)!
      working.set(id, updated)
      participantRatings.set(id, updated)
    }
    onMatchRated?.(match, participantRatings)
  }

  for (const [id, value] of working) {
    ratings.set(id, value)
  }

  const inactive = seasonPoolIds.filter((id) => !participants.has(id))
  applyInactivityToPlayers(ratings, inactive)
}

export function teamWinProbability(
  homePlayers: SkillRating[],
  awayPlayers: SkillRating[],
): number | null {
  if (homePlayers.length === 0 || awayPlayers.length === 0) return null
  return winProbability(
    homePlayers.map(toTrueSkill),
    awayPlayers.map(toTrueSkill),
  )
}

export function buildRankingRows(
  pool: {
    id: string
    name: string
    status?: 'active' | 'inactive'
    rating: number
    rating_deviation: number
    volatility: number
  }[],
): PlayerRankingRow[] {
  const sorted = [...pool].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating
    if (a.rating_deviation !== b.rating_deviation) {
      return a.rating_deviation - b.rating_deviation
    }
    return a.name.localeCompare(b.name)
  })

  return sorted.map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    status: player.status === 'inactive' ? 'inactive' : 'active',
    rating: player.rating,
    ratingDeviation: player.rating_deviation,
    volatility: player.volatility,
    title: null,
  }))
}

export function roundRating(value: number): number {
  return Math.round(value)
}
