import { describe, expect, it } from 'vitest'
import { MatchResultValidationError, resultFromScores, validateForfeitTeam, validateMatchResult } from './matchResultValidation'

const base = {
  homeTeamId: 'home',
  awayTeamId: 'away',
  winnerTeamId: 'home',
}

describe('resultFromScores', () => {
  it.each([
    [11, 7, 'home'],
    [7, 11, 'away'],
    [11, 0, 'home'],
    [0, 11, 'away'],
  ])('derives the winner from %i–%i and preserves both scores', (homeScore, awayScore, winnerTeamId) => {
    expect(resultFromScores('home', 'away', homeScore, awayScore)).toEqual({
      winnerTeamId, homeScore, awayScore,
    })
  })

  it.each([
    [11, 11],
    [0, 0],
    [-1, 11],
    [11, -1],
    [11.5, 7],
    [11, 7.5],
    [NaN, 11],
    [11, Infinity],
  ])('rejects tied or invalid scores %s–%s', (homeScore, awayScore) => {
    expect(() => resultFromScores('home', 'away', homeScore, awayScore)).toThrow()
  })
})

describe('validateMatchResult', () => {
  it.each([
    [{ ...base, homeScore: 11, awayScore: 11 }, 'scoresTied'],
    [{ ...base, homeScore: -1, awayScore: 11 }, 'scoresInvalid'],
    [{ ...base, homeScore: 11 }, 'scoresRequired'],
  ])('provides a validation code for translated field errors %#', (input, code) => {
    expect.assertions(2)
    try {
      validateMatchResult(input)
    } catch (error) {
      expect(error).toBeInstanceOf(MatchResultValidationError)
      expect(error).toMatchObject({ code })
    }
  })

  it('allows a scoreless result', () => {
    expect(() => validateMatchResult(base)).not.toThrow()
  })

  it('allows paired scores that agree with the winner', () => {
    expect(() =>
      validateMatchResult({ ...base, homeScore: 11, awayScore: 7 }),
    ).not.toThrow()
  })

  it.each([
    [{ ...base, winnerTeamId: 'other' }, 'Winner must be one of the teams'],
    [{ ...base, homeScore: 11 }, 'Enter both team scores'],
    [{ ...base, homeScore: -1, awayScore: 0 }, 'nonnegative whole numbers'],
    [{ ...base, homeScore: 11.5, awayScore: 7 }, 'nonnegative whole numbers'],
    [{ ...base, homeScore: 11, awayScore: 11 }, 'cannot be tied'],
    [{ ...base, homeScore: 7, awayScore: 11 }, 'does not match'],
  ])('rejects invalid input %#', (input, message) => {
    expect(() => validateMatchResult(input as typeof base)).toThrow(message as string)
  })
})

describe('validateForfeitTeam', () => {
  it('allows either participant to forfeit', () => {
    expect(() => validateForfeitTeam('home', 'home', 'away')).not.toThrow()
    expect(() => validateForfeitTeam('away', 'home', 'away')).not.toThrow()
  })

  it('rejects a nonparticipant', () => {
    expect(() => validateForfeitTeam('other', 'home', 'away')).toThrow(
      'must be one of the teams',
    )
  })
})
