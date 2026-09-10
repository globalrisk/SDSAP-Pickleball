import { describe, expect, it } from 'vitest'
import {
  buildRotationStandings,
  compareRotationStandings,
  getRotationPodium,
  validateRotationScore,
} from './rotationStandings'
import type { RotationMatch, RotationPlayer, RotationStanding } from './rotationTypes'

const players: RotationPlayer[] = ['Amy', 'Bao', 'Chi', 'Dan'].map((name, index) => ({
  id: `p${index + 1}`,
  event_id: 'event',
  name,
  display_order: index,
  created_at: '',
}))

function completedMatch(
  id: string,
  teamA: [string, string],
  teamB: [string, string],
  score: [number, number],
): RotationMatch {
  return {
    id,
    event_id: 'event',
    sequence_number: Number(id.slice(1)),
    team_a_player_1_id: teamA[0],
    team_a_player_2_id: teamA[1],
    team_b_player_1_id: teamB[0],
    team_b_player_2_id: teamB[1],
    status: 'completed',
    court_number: null,
    team_a_score: score[0],
    team_b_score: score[1],
    result_recorded_at: '2026-01-01T00:00:00Z',
    revision: 1,
    created_at: '',
    updated_at: '',
  }
}

describe('rotation score validation', () => {
  it.each([
    [11, 0],
    [11, 9],
    [14, 12],
    [8, 11],
  ])('accepts %i-%i', (a, b) => expect(() => validateRotationScore(a, b)).not.toThrow())

  it.each([
    [11, 10],
    [10, 8],
    [11, 11],
    [-1, 11],
    [11.5, 8],
  ])('rejects %s-%s', (a, b) => expect(() => validateRotationScore(a, b)).toThrow())
})

describe('rotation standings', () => {
  it('ranks by wins and score statistics', () => {
    const standings = buildRotationStandings(players, [
      completedMatch('m1', ['p1', 'p2'], ['p3', 'p4'], [11, 5]),
      completedMatch('m2', ['p1', 'p3'], ['p2', 'p4'], [11, 9]),
    ])
    expect(standings.map((row) => row.name)).toEqual(['Amy', 'Bao', 'Chi', 'Dan'])
    expect(standings[0]).toMatchObject({ wins: 2, played: 2, pointDifferential: 8 })
    expect(standings[1]?.wins).toBe(1)
    expect(standings[1]?.pointDifferential).toBe(4)
  })

  it('uses name as the final deterministic tie-breaker', () => {
    expect(buildRotationStandings(players, []).map((row) => row.name)).toEqual([
      'Amy',
      'Bao',
      'Chi',
      'Dan',
    ])
  })

  it.each([
    ['wins', { wins: 3 }, { wins: 2 }],
    ['point differential', { pointDifferential: 8 }, { pointDifferential: 7 }],
    ['points scored', { pointsFor: 35 }, { pointsFor: 34 }],
    ['opponents win rate', { opponentsWinRate: 0.6 }, { opponentsWinRate: 0.5 }],
    ['player name', { name: 'Amy' }, { name: 'Bao' }],
  ])('uses %s as an ordered tie-breaker', (_label, firstChange, secondChange) => {
    const base: RotationStanding = {
      rank: 0,
      playerId: 'base',
      name: 'Same',
      played: 3,
      wins: 2,
      losses: 1,
      pointsFor: 33,
      pointsAgainst: 25,
      pointDifferential: 8,
      opponentsWinRate: 0.5,
    }
    const first = { ...base, playerId: 'first', ...firstChange }
    const second = { ...base, playerId: 'second', ...secondChange }
    expect(compareRotationStandings(first, second)).toBeLessThan(0)
  })

  it('only exposes a three-player podium after completion', () => {
    const standings = buildRotationStandings(players, [])
    expect(getRotationPodium(standings, false)).toEqual([])
    expect(getRotationPodium(standings, true).map((row) => row.name)).toEqual([
      'Amy',
      'Bao',
      'Chi',
    ])
  })
})
