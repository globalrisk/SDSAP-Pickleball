export interface MatchResultInput {
  homeTeamId: string
  awayTeamId: string
  winnerTeamId: string
  homeScore?: number
  awayScore?: number
}

export function validateMatchResult(input: MatchResultInput): void {
  const { homeTeamId, awayTeamId, winnerTeamId, homeScore, awayScore } = input

  if (winnerTeamId !== homeTeamId && winnerTeamId !== awayTeamId) {
    throw new Error('Winner must be one of the teams in this match')
  }

  const hasHomeScore = homeScore != null
  const hasAwayScore = awayScore != null
  if (hasHomeScore !== hasAwayScore) {
    throw new Error('Enter both team scores or leave both blank')
  }
  if (!hasHomeScore || !hasAwayScore) return

  if (
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    awayScore < 0
  ) {
    throw new Error('Scores must be nonnegative whole numbers')
  }
  if (homeScore === awayScore) {
    throw new Error('Match scores cannot be tied')
  }

  const scoreWinnerId = homeScore > awayScore ? homeTeamId : awayTeamId
  if (winnerTeamId !== scoreWinnerId) {
    throw new Error('Selected winner does not match the entered scores')
  }
}

export function validateForfeitTeam(
  forfeitTeamId: string,
  homeTeamId: string,
  awayTeamId: string,
): void {
  if (forfeitTeamId !== homeTeamId && forfeitTeamId !== awayTeamId) {
    throw new Error('Forfeiting team must be one of the teams in this match')
  }
}
