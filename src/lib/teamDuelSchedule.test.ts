import { describe, expect, it } from 'vitest'
import {
  flattenTeamDuelSchedule,
  generateTeamDuelSchedule,
  getStartableTeamDuelMatches,
  getTeamDuelScore,
  validateTeamDuelScore,
} from './teamDuelSchedule'
import type { TeamDuelMatch } from './teamDuelTypes'

const expectedPairs = {
  4: [
    [[1, 4], [2, 3]],
    [[1, 3], [4, 2]],
    [[1, 2], [3, 4]],
  ],
  5: [
    [[2, 5], [3, 4]],
    [[1, 5], [2, 3]],
    [[1, 4], [5, 3]],
    [[1, 3], [4, 2]],
    [[1, 2], [4, 5]],
  ],
  6: [
    [[1, 6], [2, 5], [3, 4]],
    [[1, 5], [6, 4], [2, 3]],
    [[1, 4], [5, 3], [6, 2]],
    [[1, 3], [4, 2], [5, 6]],
    [[1, 2], [3, 6], [4, 5]],
  ],
} as const

function pairKey(first: number, second: number) {
  return [first, second].toSorted((a, b) => a - b).join(':')
}

describe('Team Duel schedule generation', () => {
  for (const size of [4, 5, 6] as const) {
    it(`creates the exact ${size}-player circle schedule with every partnership once`, () => {
      const rounds = generateTeamDuelSchedule(size)
      expect(rounds.map((round) => round.matches.map((match) => match.rankPair))).toEqual(
        expectedPairs[size],
      )
      expect(rounds).toHaveLength(size % 2 === 0 ? size - 1 : size)
      expect(flattenTeamDuelSchedule(size)).toHaveLength((size * (size - 1)) / 2)

      const partnerships = new Set<string>()
      const appearances = new Map<number, number>()
      for (const round of rounds) {
        const roundPlayers = new Set<number>()
        for (const match of round.matches) {
          const [first, second] = match.rankPair
          expect(roundPlayers.has(first)).toBe(false)
          expect(roundPlayers.has(second)).toBe(false)
          roundPlayers.add(first)
          roundPlayers.add(second)
          partnerships.add(pairKey(first, second))
          appearances.set(first, (appearances.get(first) ?? 0) + 1)
          appearances.set(second, (appearances.get(second) ?? 0) + 1)
        }
      }
      expect(partnerships.size).toBe((size * (size - 1)) / 2)
      for (let rank = 1; rank <= size; rank += 1) {
        expect(appearances.get(rank)).toBe(size - 1)
      }
    })
  }

  it('gives each rank one mirrored bye in the five-player format', () => {
    const byes = generateTeamDuelSchedule(5).map((round) => round.byeRank)
    expect(byes.toSorted((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5])
  })

  it('rejects unsupported squad sizes', () => {
    expect(() => generateTeamDuelSchedule(3)).toThrow(/4, 5, or 6/)
    expect(() => generateTeamDuelSchedule(7)).toThrow(/4, 5, or 6/)
  })
})

function match(overrides: Partial<TeamDuelMatch>): TeamDuelMatch {
  return {
    id: crypto.randomUUID(),
    event_id: 'event',
    kind: 'standard',
    round_number: 1,
    sequence_number: 1,
    team_a_rank_1: 1,
    team_a_rank_2: 4,
    team_b_rank_1: 1,
    team_b_rank_2: 4,
    status: 'available',
    court_number: null,
    team_a_score: null,
    team_b_score: null,
    result_recorded_at: null,
    revision: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('Team Duel live helpers', () => {
  it('validates standard pickleball scores', () => {
    expect(() => validateTeamDuelScore(11, 9)).not.toThrow()
    expect(() => validateTeamDuelScore(12, 10)).not.toThrow()
    expect(() => validateTeamDuelScore(11, 10)).toThrow()
    expect(() => validateTeamDuelScore(10, 8)).toThrow()
  })

  it('derives one team point from every completed match, including a tiebreak', () => {
    const matches = [
      match({ status: 'completed', team_a_score: 11, team_b_score: 7 }),
      match({ status: 'completed', team_a_score: 8, team_b_score: 11 }),
      match({ kind: 'tiebreak', status: 'completed', team_a_score: 12, team_b_score: 10 }),
    ]
    expect(getTeamDuelScore(matches)).toEqual({ teamA: 2, teamB: 1, completed: 3, total: 3 })
  })

  it('recommends later rounds only when their players are free', () => {
    const matches = [
      match({ id: 'playing', status: 'playing', court_number: 1 }),
      match({ id: 'blocked', round_number: 2, team_a_rank_1: 1, team_a_rank_2: 3, team_b_rank_1: 1, team_b_rank_2: 3 }),
      match({ id: 'free', round_number: 2, sequence_number: 3, team_a_rank_1: 2, team_a_rank_2: 3, team_b_rank_1: 2, team_b_rank_2: 3 }),
    ]
    expect(getStartableTeamDuelMatches(matches, 2).map((item) => item.id)).toEqual(['free'])
  })
})
