export type MatchResultValidationCode =
  | 'winnerInvalid'
  | 'scoresRequired'
  | 'scoresInvalid'
  | 'scoresTied'
  | 'winnerMismatch'

export class MatchResultValidationError extends Error {
  readonly code: MatchResultValidationCode

  constructor(code: MatchResultValidationCode, message: string) {
    super(message)
    this.name = 'MatchResultValidationError'
    this.code = code
  }
}

export interface MatchResultInput {
  homeTeamId: string
  awayTeamId: string
  winnerTeamId: string
  homeScore?: number
  awayScore?: number
}

export function resultFromScores(
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
) {
  const result = {
    winnerTeamId: homeScore > awayScore ? homeTeamId : awayTeamId,
    homeScore,
    awayScore,
  }
  validateMatchResult({ homeTeamId, awayTeamId, ...result })
  return result
}

export function validateMatchResult(input: MatchResultInput): void {
  const { homeTeamId, awayTeamId, winnerTeamId, homeScore, awayScore } = input

  if (winnerTeamId !== homeTeamId && winnerTeamId !== awayTeamId) {
    throw new MatchResultValidationError('winnerInvalid', 'Winner must be one of the teams in this match')
  }

  const hasHomeScore = homeScore != null
  const hasAwayScore = awayScore != null
  if (hasHomeScore !== hasAwayScore) {
    throw new MatchResultValidationError('scoresRequired', 'Enter both team scores or leave both blank')
  }
  if (!hasHomeScore || !hasAwayScore) return

  if (
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    awayScore < 0
  ) {
    throw new MatchResultValidationError('scoresInvalid', 'Scores must be nonnegative whole numbers')
  }
  if (homeScore === awayScore) {
    throw new MatchResultValidationError('scoresTied', 'Match scores cannot be tied')
  }

  const scoreWinnerId = homeScore > awayScore ? homeTeamId : awayTeamId
  if (winnerTeamId !== scoreWinnerId) {
    throw new MatchResultValidationError('winnerMismatch', 'Selected winner does not match the entered scores')
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
