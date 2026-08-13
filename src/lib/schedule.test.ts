import { describe, expect, it } from 'vitest'
import { buildRoundRobinMatches, generateRoundRobinPairings } from './schedule'

function pairKey(teamA: number, teamB: number): string {
  return teamA < teamB ? `${teamA}:${teamB}` : `${teamB}:${teamA}`
}

describe('generateRoundRobinPairings', () => {
  it.each([2, 3, 4, 5])(
    'creates a complete, conflict-free schedule for %i teams',
    (teamCount) => {
      const rounds = generateRoundRobinPairings(teamCount)
      const expectedRoundCount = teamCount % 2 === 0 ? teamCount - 1 : teamCount
      const allPairs = new Set<string>()
      const appearances = Array.from({ length: teamCount }, () => 0)

      expect(rounds).toHaveLength(expectedRoundCount)

      for (const round of rounds) {
        const teamsInRound = new Set<number>()

        for (const [home, away] of round) {
          expect(home).toBeGreaterThanOrEqual(0)
          expect(home).toBeLessThan(teamCount)
          expect(away).toBeGreaterThanOrEqual(0)
          expect(away).toBeLessThan(teamCount)
          expect(home).not.toBe(away)
          expect(teamsInRound.has(home)).toBe(false)
          expect(teamsInRound.has(away)).toBe(false)

          teamsInRound.add(home)
          teamsInRound.add(away)
          appearances[home] += 1
          appearances[away] += 1

          const key = pairKey(home, away)
          expect(allPairs.has(key)).toBe(false)
          allPairs.add(key)
        }

        expect(round).toHaveLength(Math.floor(teamCount / 2))
      }

      expect(allPairs.size).toBe((teamCount * (teamCount - 1)) / 2)
      expect(appearances).toEqual(Array.from({ length: teamCount }, () => teamCount - 1))
    },
  )

  it('is deterministic', () => {
    expect(generateRoundRobinPairings(5)).toEqual(generateRoundRobinPairings(5))
  })

  it.each([0, 1, 2.5])('rejects an invalid team count of %s', (teamCount) => {
    expect(() => generateRoundRobinPairings(teamCount)).toThrow(
      'Need at least 2 teams to create matches',
    )
  })
})

describe('buildRoundRobinMatches', () => {
  it('creates real match rows only when an odd-sized league has byes', () => {
    const matches = buildRoundRobinMatches('season-1', ['A', 'B', 'C'])

    expect(matches).toHaveLength(3)
    expect(new Set(matches.map((match) => match.round_number))).toEqual(new Set([1, 2, 3]))
    expect(
      new Set(
        matches.map((match) =>
          [match.home_team_id, match.away_team_id].sort().join(':'),
        ),
      ),
    ).toEqual(new Set(['A:B', 'A:C', 'B:C']))
    expect(matches.every((match) => match.season_id === 'season-1')).toBe(true)
    expect(matches.every((match) => match.status === 'scheduled')).toBe(true)
  })
})
