import { describe, expect, it } from 'vitest'
import { validateForfeitTeam, validateMatchResult } from './matchResultValidation'

const base = {
  homeTeamId: 'home',
  awayTeamId: 'away',
  winnerTeamId: 'home',
}

describe('validateMatchResult', () => {
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
