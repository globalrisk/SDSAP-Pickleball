import type {
  GeneratedRotationMatch,
  RotationMatch,
  RotationPlayer,
} from './rotationTypes'

type Partnership = readonly [string, string]

interface CandidateSchedule {
  matches: GeneratedRotationMatch[]
  opponentPenalty: number
  consecutivePenalty: number
}

export interface RotationScheduleValidation {
  valid: boolean
  code: 'playerCount' | 'matchesPerPlayer' | 'divisibility' | 'courtCount' | null
  message: string | null
  suggestedMatchesPerPlayer: number[]
}

function mulberry32(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function opponentKey(a: string, b: string): string {
  return pairKey(a, b)
}

export function validateRotationConfiguration(
  playerCount: number,
  matchesPerPlayer: number,
  courtCount: number,
): RotationScheduleValidation {
  const suggestions = Number.isInteger(playerCount) && playerCount >= 4
    ? Array.from({ length: playerCount - 1 }, (_, index) => index + 1)
        .filter((count) => (playerCount * count) % 4 === 0)
        .sort(
          (a, b) =>
            Math.abs(a - matchesPerPlayer) - Math.abs(b - matchesPerPlayer) || a - b,
        )
        .slice(0, 2)
    : []

  if (!Number.isInteger(playerCount) || playerCount < 4) {
    return {
      valid: false,
      code: 'playerCount',
      message: 'Enter at least 4 players.',
      suggestedMatchesPerPlayer: suggestions,
    }
  }
  if (
    !Number.isInteger(matchesPerPlayer) ||
    matchesPerPlayer < 1 ||
    matchesPerPlayer >= playerCount
  ) {
    return {
      valid: false,
      code: 'matchesPerPlayer',
      message: `Matches per player must be between 1 and ${playerCount - 1}.`,
      suggestedMatchesPerPlayer: suggestions,
    }
  }
  if ((playerCount * matchesPerPlayer) % 4 !== 0) {
    return {
      valid: false,
      code: 'divisibility',
      message: 'Players × matches per player must be divisible by 4.',
      suggestedMatchesPerPlayer: suggestions,
    }
  }
  const maximumCourts = Math.floor(playerCount / 4)
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > maximumCourts) {
    return {
      valid: false,
      code: 'courtCount',
      message: `Court count must be between 1 and ${maximumCourts}.`,
      suggestedMatchesPerPlayer: suggestions,
    }
  }
  return { valid: true, code: null, message: null, suggestedMatchesPerPlayer: suggestions }
}

function createPartnerships(
  playerIds: readonly string[],
  matchesPerPlayer: number,
  random: () => number,
): Partnership[] {
  const players = shuffle(playerIds, random)

  if (players.length % 2 === 0) {
    const rounds: Partnership[][] = []
    const rotation = [...players]
    for (let round = 0; round < players.length - 1; round += 1) {
      const pairs: Partnership[] = []
      for (let index = 0; index < rotation.length / 2; index += 1) {
        pairs.push([rotation[index]!, rotation[rotation.length - 1 - index]!])
      }
      rounds.push(pairs)
      const fixed = rotation[0]!
      const rest = rotation.slice(1)
      rest.unshift(rest.pop()!)
      rotation.splice(0, rotation.length, fixed, ...rest)
    }
    return shuffle(rounds, random).slice(0, matchesPerPlayer).flat()
  }

  const distances = shuffle(
    Array.from({ length: (players.length - 1) / 2 }, (_, index) => index + 1),
    random,
  ).slice(0, matchesPerPlayer / 2)
  const pairs: Partnership[] = []
  for (const distance of distances) {
    for (let index = 0; index < players.length; index += 1) {
      pairs.push([players[index]!, players[(index + distance) % players.length]!])
    }
  }
  return pairs
}

function pairingScore(
  first: Partnership,
  second: Partnership,
  opponentCounts: ReadonlyMap<string, number>,
) {
  const counts = [
    opponentCounts.get(opponentKey(first[0], second[0])) ?? 0,
    opponentCounts.get(opponentKey(first[0], second[1])) ?? 0,
    opponentCounts.get(opponentKey(first[1], second[0])) ?? 0,
    opponentCounts.get(opponentKey(first[1], second[1])) ?? 0,
  ]
  return counts.reduce((sum, count) => sum + (count + 1) ** 2, 0)
}

function pairPartnershipsIntoMatches(
  partnerships: readonly Partnership[],
  random: () => number,
): Omit<GeneratedRotationMatch, 'sequenceNumber'>[] | null {
  const opponentCounts = new Map<string, number>()

  function search(remaining: Partnership[]): Omit<GeneratedRotationMatch, 'sequenceNumber'>[] | null {
    if (remaining.length === 0) return []

    const firstIndex = 0
    const first = remaining[firstIndex]!
    const candidates = remaining
      .map((edge, index) => ({
        edge,
        index,
        score: pairingScore(first, edge, opponentCounts),
        random: random(),
      }))
      .filter(
        ({ edge, index }) =>
          index !== firstIndex && !edge.includes(first[0]) && !edge.includes(first[1]),
      )
      .sort((a, b) => a.score - b.score || a.random - b.random)
      .slice(0, 18)

    for (const candidate of candidates) {
      const opponentPairs = [
        [first[0], candidate.edge[0]],
        [first[0], candidate.edge[1]],
        [first[1], candidate.edge[0]],
        [first[1], candidate.edge[1]],
      ] as const
      for (const [a, b] of opponentPairs) {
        const key = opponentKey(a, b)
        opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
      }

      const next = remaining.filter(
        (_, index) => index !== firstIndex && index !== candidate.index,
      )
      const tail = search(next)
      if (tail) {
        return [
          {
            teamAPlayerIds: [first[0], first[1]],
            teamBPlayerIds: [candidate.edge[0], candidate.edge[1]],
          },
          ...tail,
        ]
      }

      for (const [a, b] of opponentPairs) {
        const key = opponentKey(a, b)
        const count = (opponentCounts.get(key) ?? 1) - 1
        if (count === 0) opponentCounts.delete(key)
        else opponentCounts.set(key, count)
      }
    }
    return null
  }

  return search([...partnerships])
}

function orderMatches(
  matches: readonly Omit<GeneratedRotationMatch, 'sequenceNumber'>[],
  playerIds: readonly string[],
  random: () => number,
): GeneratedRotationMatch[] {
  const remaining = [...matches]
  const lastPlayed = new Map<string, number>()
  const ordered: GeneratedRotationMatch[] = []

  while (remaining.length > 0) {
    const currentIndex = ordered.length
    const ranked = remaining
      .map((match, index) => {
        const players = [...match.teamAPlayerIds, ...match.teamBPlayerIds]
        const rests = players.map((playerId) => {
          const last = lastPlayed.get(playerId)
          return last == null ? currentIndex + 2 : currentIndex - last - 1
        })
        return {
          index,
          match,
          backToBack: rests.filter((rest) => rest === 0).length,
          minimumRest: Math.min(...rests),
          totalRest: rests.reduce((sum, rest) => sum + rest, 0),
          random: random(),
        }
      })
      .sort(
        (a, b) =>
          a.backToBack - b.backToBack ||
          b.minimumRest - a.minimumRest ||
          b.totalRest - a.totalRest ||
          a.random - b.random,
      )

    const chosen = ranked[0]!
    remaining.splice(chosen.index, 1)
    const sequenceNumber = ordered.length + 1
    ordered.push({ ...chosen.match, sequenceNumber })
    for (const playerId of [...chosen.match.teamAPlayerIds, ...chosen.match.teamBPlayerIds]) {
      lastPlayed.set(playerId, sequenceNumber - 1)
    }
  }

  void playerIds
  return ordered
}

function evaluateSchedule(
  matches: GeneratedRotationMatch[],
  playerIds: readonly string[],
): Omit<CandidateSchedule, 'matches'> {
  const opponentCounts = new Map<string, number>()
  const lastPlayed = new Map<string, number>()
  let consecutivePenalty = 0

  matches.forEach((match, index) => {
    const teams = [match.teamAPlayerIds, match.teamBPlayerIds] as const
    for (const first of teams[0]) {
      for (const second of teams[1]) {
        const key = opponentKey(first, second)
        opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
      }
    }
    for (const playerId of [...teams[0], ...teams[1]]) {
      if (lastPlayed.get(playerId) === index - 1) consecutivePenalty += 1
      lastPlayed.set(playerId, index)
    }
  })

  let opponentPenalty = 0
  for (let first = 0; first < playerIds.length; first += 1) {
    for (let second = first + 1; second < playerIds.length; second += 1) {
      const count = opponentCounts.get(opponentKey(playerIds[first]!, playerIds[second]!)) ?? 0
      opponentPenalty += count ** 2
    }
  }
  return { opponentPenalty, consecutivePenalty }
}

export function generateRotationSchedule(
  playerIds: readonly string[],
  matchesPerPlayer: number,
  courtCount: number,
  seed: number,
): GeneratedRotationMatch[] {
  const validation = validateRotationConfiguration(
    playerIds.length,
    matchesPerPlayer,
    courtCount,
  )
  if (!validation.valid) throw new Error(validation.message ?? 'Invalid configuration')
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('Player IDs must be unique.')
  }

  let best: CandidateSchedule | null = null
  const partnershipCount = (playerIds.length * matchesPerPlayer) / 2
  const qualityAttempts = Math.max(24, Math.min(80, playerIds.length * 4))
  const attempts = partnershipCount <= 80 ? qualityAttempts : partnershipCount <= 250 ? 16 : 8
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const random = mulberry32((seed + Math.imul(attempt + 1, 0x9e3779b1)) >>> 0)
    const partnerships = createPartnerships(playerIds, matchesPerPlayer, random)
    const paired = pairPartnershipsIntoMatches(partnerships, random)
    if (!paired) continue
    const matches = orderMatches(paired, playerIds, random)
    const score = evaluateSchedule(matches, playerIds)
    const candidate = { matches, ...score }
    if (
      !best ||
      candidate.opponentPenalty < best.opponentPenalty ||
      (candidate.opponentPenalty === best.opponentPenalty &&
        candidate.consecutivePenalty < best.consecutivePenalty)
    ) {
      best = candidate
    }
  }

  if (!best) {
    throw new Error('Could not build a valid schedule. Try another configuration or regenerate.')
  }
  return best.matches
}

function matchPlayerIds(match: RotationMatch): string[] {
  return [
    match.team_a_player_1_id,
    match.team_a_player_2_id,
    match.team_b_player_1_id,
    match.team_b_player_2_id,
  ]
}

export function recommendRotationMatch(
  matches: readonly RotationMatch[],
  players: readonly RotationPlayer[],
): RotationMatch | null {
  const playingPlayers = new Set(
    matches.filter((match) => match.status === 'playing').flatMap(matchPlayerIds),
  )
  const completed = matches
    .filter((match) => match.status === 'completed')
    .sort(
      (a, b) =>
        (a.result_recorded_at ?? '').localeCompare(b.result_recorded_at ?? '') ||
        a.sequence_number - b.sequence_number,
    )
  const played = new Map(players.map((player) => [player.id, 0]))
  const lastPlayed = new Map<string, number>()
  completed.forEach((match, index) => {
    for (const playerId of matchPlayerIds(match)) {
      played.set(playerId, (played.get(playerId) ?? 0) + 1)
      lastPlayed.set(playerId, index)
    }
  })

  return (
    matches
      .filter(
        (match) =>
          match.status === 'available' &&
          matchPlayerIds(match).every((playerId) => !playingPlayers.has(playerId)),
      )
      .map((match) => {
        const ids = matchPlayerIds(match)
        const projected = players.map(
          (player) => (played.get(player.id) ?? 0) + Number(ids.includes(player.id)),
        )
        const rests = ids.map((playerId) => {
          const last = lastPlayed.get(playerId)
          return last == null ? completed.length + 1 : completed.length - last - 1
        })
        return {
          match,
          appearanceSpread: Math.max(...projected) - Math.min(...projected),
          backToBack: rests.filter((rest) => rest === 0).length,
          minimumRest: Math.min(...rests),
          totalRest: rests.reduce((sum, rest) => sum + rest, 0),
        }
      })
      .sort(
        (a, b) =>
          a.appearanceSpread - b.appearanceSpread ||
          a.backToBack - b.backToBack ||
          b.minimumRest - a.minimumRest ||
          b.totalRest - a.totalRest ||
          a.match.sequence_number - b.match.sequence_number,
      )[0]?.match ?? null
  )
}
