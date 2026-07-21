interface RatedPlayer {
  rating?: number
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

function averageTeamRating(team: RatedTeam): number | null {
  const ratings = (team.players ?? [])
    .map((player) => player.rating)
    .filter((rating): rating is number => Number.isFinite(rating))

  if (ratings.length === 0) return null
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
}

export function calculateMatchProbability(
  homeTeam: RatedTeam,
  awayTeam: RatedTeam,
): MatchProbability | null {
  const homeRating = averageTeamRating(homeTeam)
  const awayRating = averageTeamRating(awayTeam)

  if (homeRating === null || awayRating === null) return null

  const home = 1 / (1 + 10 ** ((awayRating - homeRating) / 400))

  return {
    home,
    away: 1 - home,
    homeRating,
    awayRating,
  }
}
