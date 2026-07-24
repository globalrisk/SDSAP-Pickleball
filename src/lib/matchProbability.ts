import { teamWinProbability, type SkillRating } from './ratings'

interface RatedPlayer {
  rating?: number
  ratingDeviation?: number
  rating_deviation?: number
}

interface RatedTeam {
  players?: RatedPlayer[]
}

export interface MatchProbability {
  home: number
  away: number
  homeRating: number
  awayRating: number
}

function toSkillRatings(team: RatedTeam): SkillRating[] | null {
  const players = (team.players ?? []).filter((player) =>
    Number.isFinite(player.rating),
  )
  if (players.length === 0) return null

  return players.map((player) => ({
    rating: player.rating as number,
    rd: player.ratingDeviation ?? player.rating_deviation ?? 350,
    volatility: 0,
  }))
}

function averageRating(ratings: SkillRating[]): number {
  return ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length
}

/**
 * Doubles win probability via TrueSkill team model (partner-aware).
 */
export function calculateMatchProbability(
  homeTeam: RatedTeam,
  awayTeam: RatedTeam,
): MatchProbability | null {
  const homePlayers = toSkillRatings(homeTeam)
  const awayPlayers = toSkillRatings(awayTeam)
  if (!homePlayers || !awayPlayers) return null

  const home = teamWinProbability(homePlayers, awayPlayers)
  if (home == null || !Number.isFinite(home)) return null

  return {
    home,
    away: 1 - home,
    homeRating: averageRating(homePlayers),
    awayRating: averageRating(awayPlayers),
  }
}
