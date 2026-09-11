import { describe, expect, it } from 'vitest'
import {
  generateRotationSchedule,
  getNextRotationPlannedRound,
  getRotationStartableMatchIds,
  isRotationPlannedRestRound,
  recommendRotationMatch,
  validateRotationConfiguration,
} from './rotationSchedule'
import type { RotationMatch, RotationPlayer } from './rotationTypes'

function playerIds(count: number) {
  return Array.from({ length: count }, (_, index) => `player-${index + 1}`)
}

function matchPlayers(match: {
  teamAPlayerIds: readonly string[]
  teamBPlayerIds: readonly string[]
}) {
  return [...match.teamAPlayerIds, ...match.teamBPlayerIds]
}

function generatedRounds(
  matches: ReturnType<typeof generateRotationSchedule>,
  courtCount: number,
) {
  const rounds: typeof matches[] = []
  let round: typeof matches = []
  let roundPlayerIds = new Set<string>()
  for (const match of matches) {
    const ids = matchPlayers(match)
    if (round.length >= courtCount || ids.some((id) => roundPlayerIds.has(id))) {
      rounds.push(round)
      round = []
      roundPlayerIds = new Set()
    }
    round.push(match)
    for (const id of ids) roundPlayerIds.add(id)
  }
  if (round.length > 0) rounds.push(round)
  return rounds
}

describe('rotation schedule generation', () => {
  it('builds the default 10-player schedule with exact appearances and unique partners', () => {
    const ids = playerIds(10)
    const matches = generateRotationSchedule(ids, 6, 2, 20260911)
    const appearances = new Map(ids.map((id) => [id, 0]))
    const partnerships = new Set<string>()

    expect(matches).toHaveLength(15)
    for (const match of matches) {
      expect(new Set(matchPlayers(match))).toHaveLength(4)
      for (const id of matchPlayers(match)) {
        appearances.set(id, (appearances.get(id) ?? 0) + 1)
      }
      for (const pair of [match.teamAPlayerIds, match.teamBPlayerIds]) {
        const key = [...pair].sort().join(':')
        expect(partnerships.has(key)).toBe(false)
        partnerships.add(key)
      }
    }
    expect([...appearances.values()]).toEqual(Array.from({ length: 10 }, () => 6))
  })

  it.each([1, 42, 123, 20260911])(
    'uses the optimized eight-round rest pattern for seed %i',
    (seed) => {
      const matches = generateRotationSchedule(playerIds(10), 6, 2, seed)
      const rounds = generatedRounds(matches, 2)
      const streaks = new Map(playerIds(10).map((id) => [id, 0]))
      const rests = new Map(playerIds(10).map((id) => [id, 0]))
      let maximumStreak = 0
      let maximumRest = 0

      expect(rounds.map((round) => round.length)).toEqual([2, 2, 2, 2, 1, 2, 2, 2])
      for (const round of rounds) {
        const active = new Set(round.flatMap(matchPlayers))
        expect(active.size).toBe(round.length * 4)
        for (const id of playerIds(10)) {
          const streak = active.has(id) ? streaks.get(id)! + 1 : 0
          const rest = active.has(id) ? 0 : rests.get(id)! + 1
          streaks.set(id, streak)
          rests.set(id, rest)
          maximumStreak = Math.max(maximumStreak, streak)
          maximumRest = Math.max(maximumRest, rest)
        }
      }
      expect(maximumStreak).toBeLessThanOrEqual(4)
      expect(maximumRest).toBe(1)
    },
  )

  it('preserves the optimized template across 1,000 random player assignments', () => {
    const ids = playerIds(10)
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const matches = generateRotationSchedule(ids, 6, 2, seed)
      const appearances = new Map(ids.map((id) => [id, 0]))
      const partnerships = new Set<string>()
      let maximumStreak = 0
      const streaks = new Map(ids.map((id) => [id, 0]))

      for (const match of matches) {
        for (const id of matchPlayers(match)) {
          appearances.set(id, appearances.get(id)! + 1)
        }
        for (const pair of [match.teamAPlayerIds, match.teamBPlayerIds]) {
          const key = [...pair].sort().join(':')
          expect(partnerships.has(key)).toBe(false)
          partnerships.add(key)
        }
      }
      for (const round of generatedRounds(matches, 2)) {
        const active = new Set(round.flatMap(matchPlayers))
        for (const id of ids) {
          const streak = active.has(id) ? streaks.get(id)! + 1 : 0
          streaks.set(id, streak)
          maximumStreak = Math.max(maximumStreak, streak)
        }
      }

      expect([...appearances.values()]).toEqual(Array.from({ length: 10 }, () => 6))
      expect(maximumStreak).toBeLessThanOrEqual(4)
    }
  })

  it.each([
    [4, 3, 1],
    [5, 4, 1],
    [6, 2, 1],
    [8, 5, 2],
    [9, 4, 2],
    [10, 8, 2],
  ])('supports %i players playing %i matches', (count, matchesEach, courts) => {
    const ids = playerIds(count)
    const matches = generateRotationSchedule(ids, matchesEach, courts, 42)
    const appearances = new Map(ids.map((id) => [id, 0]))
    const partnerships = new Set<string>()
    for (const match of matches) {
      for (const id of matchPlayers(match)) appearances.set(id, appearances.get(id)! + 1)
      for (const pair of [match.teamAPlayerIds, match.teamBPlayerIds]) {
        const key = [...pair].sort().join(':')
        expect(partnerships.has(key)).toBe(false)
        partnerships.add(key)
      }
    }
    expect(matches).toHaveLength((count * matchesEach) / 4)
    expect([...appearances.values()]).toEqual(Array.from({ length: count }, () => matchesEach))
  })

  it('handles a larger feasible roster without relaxing the hard constraints', () => {
    const ids = playerIds(40)
    const matches = generateRotationSchedule(ids, 39, 10, 20260911)
    const appearances = new Map(ids.map((id) => [id, 0]))
    const partnerships = new Set<string>()
    for (const match of matches) {
      expect(new Set(matchPlayers(match))).toHaveLength(4)
      for (const id of matchPlayers(match)) appearances.set(id, appearances.get(id)! + 1)
      for (const pair of [match.teamAPlayerIds, match.teamBPlayerIds]) {
        const key = [...pair].sort().join(':')
        expect(partnerships.has(key)).toBe(false)
        partnerships.add(key)
      }
    }
    expect(matches).toHaveLength(390)
    expect([...appearances.values()]).toEqual(Array.from({ length: 40 }, () => 39))
  })

  it('is reproducible by seed and can vary with a new seed', () => {
    const ids = playerIds(10)
    const first = generateRotationSchedule(ids, 6, 2, 123)
    const repeated = generateRotationSchedule(ids, 6, 2, 123)
    const different = generateRotationSchedule(ids, 6, 2, 456)
    expect(repeated).toEqual(first)
    expect(different).not.toEqual(first)
  })

  it('rejects impossible configurations and suggests nearby values', () => {
    const invalid = validateRotationConfiguration(10, 5, 2)
    expect(invalid.valid).toBe(false)
    expect(invalid.suggestedMatchesPerPlayer).toContain(4)
    expect(() => generateRotationSchedule(playerIds(10), 10, 2, 1)).toThrow(
      'between 1 and 9',
    )
    expect(() => generateRotationSchedule(playerIds(6), 2, 2, 1)).toThrow(
      'Court count',
    )
  })
})

function rotationPlayer(id: string): RotationPlayer {
  return {
    id,
    event_id: 'event',
    name: id,
    display_order: Number(id.slice(1)),
    created_at: '',
  }
}

function persistedMatchPlayers(match: RotationMatch) {
  return [
    match.team_a_player_1_id,
    match.team_a_player_2_id,
    match.team_b_player_1_id,
    match.team_b_player_2_id,
  ]
}

function rotationMatch(
  id: string,
  sequence: number,
  players: [string, string, string, string],
  status: RotationMatch['status'] = 'available',
): RotationMatch {
  return {
    id,
    event_id: 'event',
    sequence_number: sequence,
    team_a_player_1_id: players[0],
    team_a_player_2_id: players[1],
    team_b_player_1_id: players[2],
    team_b_player_2_id: players[3],
    status,
    court_number: status === 'playing' ? 1 : null,
    team_a_score: status === 'completed' ? 11 : null,
    team_b_score: status === 'completed' ? 7 : null,
    result_recorded_at: status === 'completed' ? `2026-01-0${sequence}` : null,
    revision: 0,
    created_at: '',
    updated_at: '',
  }
}

describe('rotation match recommendation', () => {
  it('groups the earliest unfinished matches into a planned court round', () => {
    const first = rotationMatch('first', 1, ['p1', 'p2', 'p3', 'p4'], 'completed')
    const second = rotationMatch('second', 2, ['p5', 'p6', 'p7', 'p8'], 'completed')
    const third = rotationMatch('third', 3, ['p1', 'p5', 'p6', 'p7'])
    const fourth = rotationMatch('fourth', 4, ['p2', 'p3', 'p4', 'p8'])

    expect(getNextRotationPlannedRound([fourth, second, third, first], 2)).toEqual({
      roundNumber: 2,
      matches: [third, fourth],
    })
  })

  it('keeps a deliberate one-court rest round between full rounds', () => {
    const first = rotationMatch('first', 1, ['p1', 'p2', 'p3', 'p4'], 'completed')
    const second = rotationMatch('second', 2, ['p5', 'p6', 'p7', 'p8'], 'completed')
    const restRound = rotationMatch('rest-round', 3, ['p1', 'p5', 'p6', 'p7'])
    const nextFirst = rotationMatch('next-first', 4, ['p1', 'p2', 'p8', 'p9'])
    const nextSecond = rotationMatch('next-second', 5, ['p3', 'p4', 'p5', 'p6'])

    expect(
      getNextRotationPlannedRound([first, second, restRound, nextFirst, nextSecond], 2),
    ).toEqual({ roundNumber: 2, matches: [restRound] })
    expect(
      isRotationPlannedRestRound([first, second, restRound, nextFirst, nextSecond], 2),
    ).toBe(true)

    expect(
      getNextRotationPlannedRound(
        [first, second, { ...restRound, status: 'completed' }, nextFirst, nextSecond],
        2,
      ),
    ).toEqual({ roundNumber: 3, matches: [nextFirst, nextSecond] })
    expect(
      isRotationPlannedRestRound(
        [first, second, { ...restRound, status: 'completed' }, nextFirst, nextSecond],
        2,
      ),
    ).toBe(false)
  })

  it('prevents a first match that would strand another empty court', () => {
    const isolated = rotationMatch('isolated', 1, ['p1', 'p2', 'p3', 'p4'])
    const firstPair = rotationMatch('first-pair', 2, ['p1', 'p2', 'p5', 'p6'])
    const secondPair = rotationMatch('second-pair', 3, ['p3', 'p4', 'p7', 'p8'])
    const startable = getRotationStartableMatchIds(
      [isolated, firstPair, secondPair],
      2,
    )

    expect(startable.has(isolated.id)).toBe(false)
    expect(startable.has(firstPair.id)).toBe(true)
    expect(startable.has(secondPair.id)).toBe(true)
  })

  it('allows progress when no full set of courts can be filled', () => {
    const onlyMatch = rotationMatch('only', 1, ['p1', 'p2', 'p3', 'p4'])

    expect(getRotationStartableMatchIds([onlyMatch], 2).has(onlyMatch.id)).toBe(true)
  })

  it('starts with a match that leaves another eligible match for the second court', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'].map(rotationPlayer)
    const isolated = rotationMatch('isolated', 1, ['p1', 'p2', 'p3', 'p4'])
    const firstPair = rotationMatch('first-pair', 2, ['p1', 'p2', 'p5', 'p6'])
    const secondPair = rotationMatch('second-pair', 3, ['p3', 'p4', 'p7', 'p8'])

    expect(
      recommendRotationMatch([isolated, firstPair, secondPair], players, 2)?.id,
    ).toBe('first-pair')
  })

  it.each([1, 42, 123, 20260911])(
    'keeps the generated 10-player schedule in eight two-court rounds for seed %i',
    (seed) => {
      const ids = playerIds(10)
      const players = ids.map((id, index) => ({
        ...rotationPlayer(id),
        display_order: index + 1,
      }))
      let matches = generateRotationSchedule(ids, 6, 2, seed).map((match, index) =>
        rotationMatch(`match-${index + 1}`, match.sequenceNumber, [
          ...match.teamAPlayerIds,
          ...match.teamBPlayerIds,
        ]),
      )
      let rounds = 0

      while (matches.some((match) => match.status !== 'completed')) {
        for (let court = 1; court <= 2; court += 1) {
          const recommended = recommendRotationMatch(matches, players, 2)
          if (!recommended) break
          matches = matches.map((match) =>
            match.id === recommended.id
              ? { ...match, status: 'playing', court_number: court }
              : match,
          )
        }

        const playing = matches.filter((match) => match.status === 'playing')
        expect(playing.length).toBeGreaterThan(0)
        expect(new Set(playing.flatMap(persistedMatchPlayers))).toHaveLength(
          playing.length * 4,
        )
        rounds += 1
        matches = matches.map((match) =>
          match.status === 'playing'
            ? {
                ...match,
                status: 'completed',
                court_number: null,
                team_a_score: 11,
                team_b_score: 7,
                result_recorded_at: `2026-01-${String(rounds).padStart(2, '0')}`,
              }
            : match,
        )
      }

      expect(rounds).toBe(8)
    },
  )

  it('never recommends players who are currently on another court', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(rotationPlayer)
    const playing = rotationMatch('playing', 1, ['p1', 'p2', 'p3', 'p4'], 'playing')
    const blocked = rotationMatch('blocked', 2, ['p1', 'p5', 'p6', 'p7'])
    const eligible = rotationMatch('eligible', 3, ['p5', 'p6', 'p7', 'p8'])
    expect(recommendRotationMatch([playing, blocked, eligible], players)?.id).toBe('eligible')
  })

  it('prefers players with fewer completed appearances', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(rotationPlayer)
    const completed = rotationMatch('done', 1, ['p1', 'p2', 'p3', 'p4'], 'completed')
    const repeat = rotationMatch('repeat', 2, ['p1', 'p2', 'p3', 'p4'])
    const rested = rotationMatch('rested', 3, ['p5', 'p6', 'p7', 'p8'])
    expect(recommendRotationMatch([completed, repeat, rested], players)?.id).toBe('rested')
  })

  it('returns no recommendation when every waiting match uses an active player', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(rotationPlayer)
    const firstCourt = rotationMatch('court-1', 1, ['p1', 'p2', 'p3', 'p4'], 'playing')
    const secondCourt = { ...rotationMatch('court-2', 2, ['p5', 'p6', 'p7', 'p8'], 'playing'), court_number: 2 }
    const blocked = rotationMatch('blocked', 3, ['p1', 'p5', 'p6', 'p7'])
    expect(recommendRotationMatch([firstCourt, secondCourt, blocked], players)).toBeNull()
  })

  it('ignores unavailable matches and returns the final eligible remainder', () => {
    const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(rotationPlayer)
    const completed = rotationMatch('done', 1, ['p1', 'p2', 'p3', 'p4'], 'completed')
    const playing = { ...rotationMatch('playing', 2, ['p1', 'p5', 'p6', 'p7'], 'playing'), court_number: 1 }
    const final = rotationMatch('final', 3, ['p2', 'p3', 'p4', 'p8'])
    expect(recommendRotationMatch([completed, playing, final], players)?.id).toBe('final')
  })
})
