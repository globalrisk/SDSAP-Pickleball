import { describe, expect, it } from 'vitest'
import {
  generateBalancedTeamOptions,
  partnershipKey,
  type RatedPlayerRef,
} from './balanceTeams'

function player(id: string, rating: number): RatedPlayerRef {
  return { id, name: id.toUpperCase(), rating }
}

describe('balanced team options', () => {
  it('balances teams by their combined player ratings', () => {
    const best = generateBalancedTeamOptions([
      player('a', 1800),
      player('b', 1600),
      player('c', 1400),
      player('d', 1200),
    ])[0]!

    expect(best.fairnessPercent).toBe(100)
    expect(best.teams.map((team) => team.teamRating)).toEqual([3000, 3000])
  })

  it('reports rating balance as weakest team divided by strongest team', () => {
    const best = generateBalancedTeamOptions([
      player('a', 1900),
      player('b', 1700),
      player('c', 1450),
      player('d', 1200),
    ])[0]!

    expect(best.teams.map((team) => team.teamRating)).toEqual([3150, 3100])
    expect(best.fairnessPercent).toBe(98)
  })

  it('avoids repeat partners when rating balance is tied', () => {
    const players = ['a', 'b', 'c', 'd'].map((id) => player(id, 1500))
    const best = generateBalancedTeamOptions(
      players,
      new Map([[partnershipKey('a', 'b'), 3]]),
    )[0]!

    expect(best.teams.some((team) => team.poolPlayerIds.includes('a') && team.poolPlayerIds.includes('b'))).toBe(false)
    expect(best.repeatedPartnerships).toBe(0)
  })

  it('returns three distinct reviewable options when possible', () => {
    const options = generateBalancedTeamOptions(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => player(id, 1300 + index * 80)),
    )

    expect(options).toHaveLength(3)
    expect(new Set(options.map((option) => option.id))).toHaveLength(3)
  })

  it('requires the caller to explicitly resolve an odd roster', () => {
    expect(() =>
      generateBalancedTeamOptions([player('a', 1500), player('b', 1500), player('c', 1500)]),
    ).toThrow('even number')
  })
})
