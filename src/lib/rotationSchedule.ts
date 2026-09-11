import type {
  GeneratedRotationMatch,
  RotationMatch,
  RotationPlayer,
} from './rotationTypes'

type Partnership = readonly [string, string]

interface CandidateSchedule {
  matches: GeneratedRotationMatch[]
  idleCourtPenalty: number
  opponentPenalty: number
  consecutivePenalty: number
}

type FixedTemplateMatch = readonly [
  readonly [number, number],
  readonly [number, number],
]

const OPTIMIZED_TEN_PLAYER_TEMPLATE: readonly FixedTemplateMatch[] = [
  [[0, 8], [4, 7]],
  [[3, 1], [5, 6]],
  [[1, 0], [4, 5]],
  [[2, 9], [3, 7]],
  [[9, 5], [4, 2]],
  [[6, 3], [8, 7]],
  [[6, 1], [2, 7]],
  [[9, 8], [5, 0]],
  [[4, 3], [8, 6]],
  [[0, 2], [3, 5]],
  [[4, 1], [7, 9]],
  [[2, 1], [4, 0]],
  [[9, 6], [5, 8]],
  [[1, 8], [2, 3]],
  [[9, 0], [6, 7]],
]

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

function generatedMatchPlayerIds(
  match: Omit<GeneratedRotationMatch, 'sequenceNumber'>,
): string[] {
  return [...match.teamAPlayerIds, ...match.teamBPlayerIds]
}

function findCompatibleBatch<T>(
  candidates: readonly T[],
  targetSize: number,
  getPlayerIds: (candidate: T) => readonly string[],
  initialPlayerIds: readonly string[] = [],
): { batch: T[]; truncated: boolean } {
  if (targetSize <= 0) return { batch: [], truncated: false }

  const maximumVisits = candidates.length > 100 ? 5_000 : 20_000
  let visits = 0
  let truncated = false
  let best: T[] = []
  const usedPlayerIds = new Set(initialPlayerIds)

  function search(startIndex: number, batch: T[]): boolean {
    if (batch.length > best.length) best = [...batch]
    if (batch.length === targetSize) return true
    if (batch.length + candidates.length - startIndex < targetSize) return false

    for (let index = startIndex; index < candidates.length; index += 1) {
      visits += 1
      if (visits > maximumVisits) {
        truncated = true
        return false
      }

      const candidate = candidates[index]!
      const playerIds = getPlayerIds(candidate)
      if (playerIds.some((playerId) => usedPlayerIds.has(playerId))) continue

      for (const playerId of playerIds) usedPlayerIds.add(playerId)
      batch.push(candidate)
      if (search(index + 1, batch)) return true
      batch.pop()
      for (const playerId of playerIds) usedPlayerIds.delete(playerId)
    }
    return false
  }

  search(0, [])
  return { batch: best, truncated }
}

function buildOptimalTwoCourtBatches<T>(
  candidates: readonly T[],
  getPlayerIds: (candidate: T) => readonly string[],
  random: () => number,
): T[][] | null {
  if (candidates.length > 20) return null

  const playerSets = candidates.map((candidate) => new Set(getPlayerIds(candidate)))
  const compatible = candidates.map((_, firstIndex) =>
    candidates.map((__, secondIndex) =>
      secondIndex !== firstIndex &&
      [...playerSets[firstIndex]!].every(
        (playerId) => !playerSets[secondIndex]!.has(playerId),
      ),
    ),
  )
  const memo = new Map<bigint, number>()

  function firstSetIndex(mask: bigint): number {
    for (let index = 0; index < candidates.length; index += 1) {
      if ((mask & (1n << BigInt(index))) !== 0n) return index
    }
    return -1
  }

  function maximumPairCount(mask: bigint): number {
    if (mask === 0n) return 0
    const cached = memo.get(mask)
    if (cached != null) return cached

    const firstIndex = firstSetIndex(mask)
    const withoutFirst = mask & ~(1n << BigInt(firstIndex))
    let best = maximumPairCount(withoutFirst)
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const secondBit = 1n << BigInt(secondIndex)
      if ((withoutFirst & secondBit) === 0n || !compatible[firstIndex]![secondIndex]) continue
      best = Math.max(best, 1 + maximumPairCount(withoutFirst & ~secondBit))
    }
    memo.set(mask, best)
    return best
  }

  const batches: T[][] = []
  let mask = (1n << BigInt(candidates.length)) - 1n
  while (mask !== 0n) {
    const firstIndex = firstSetIndex(mask)
    const withoutFirst = mask & ~(1n << BigInt(firstIndex))
    const best = maximumPairCount(mask)
    const partners: number[] = []
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const secondBit = 1n << BigInt(secondIndex)
      if (
        (withoutFirst & secondBit) !== 0n &&
        compatible[firstIndex]![secondIndex] &&
        1 + maximumPairCount(withoutFirst & ~secondBit) === best
      ) {
        partners.push(secondIndex)
      }
    }

    if (partners.length === 0) {
      batches.push([candidates[firstIndex]!])
      mask = withoutFirst
      continue
    }

    const secondIndex = partners[Math.floor(random() * partners.length)]!
    batches.push([candidates[firstIndex]!, candidates[secondIndex]!])
    mask = withoutFirst & ~(1n << BigInt(secondIndex))
  }
  return batches
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

function createEvenPartnershipRounds(
  playerIds: readonly string[],
  matchesPerPlayer: number,
  random: () => number,
): Partnership[][] {
  const players = shuffle(playerIds, random)
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
  return shuffle(rounds, random).slice(0, matchesPerPlayer)
}

function createPartnerships(
  playerIds: readonly string[],
  matchesPerPlayer: number,
  random: () => number,
): Partnership[] {
  if (playerIds.length % 2 === 0) {
    return createEvenPartnershipRounds(playerIds, matchesPerPlayer, random).flat()
  }

  const players = shuffle(playerIds, random)
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

function pairEvenPartnershipRoundsIntoMatches(
  rounds: readonly Partnership[][],
  random: () => number,
): Omit<GeneratedRotationMatch, 'sequenceNumber'>[] | null {
  const matches: Omit<GeneratedRotationMatch, 'sequenceNumber'>[] = []
  const leftovers: Partnership[] = []

  for (const round of rounds) {
    const partnerships = shuffle(round, random)
    if (partnerships.length % 2 === 1) leftovers.push(partnerships.pop()!)
    for (let index = 0; index < partnerships.length; index += 2) {
      const first = partnerships[index]!
      const second = partnerships[index + 1]!
      matches.push({
        teamAPlayerIds: [first[0], first[1]],
        teamBPlayerIds: [second[0], second[1]],
      })
    }
  }

  if (leftovers.length === 0) return matches
  const overflowMatches = pairPartnershipsIntoMatches(leftovers, random)
  return overflowMatches ? [...matches, ...overflowMatches] : null
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
  courtCount: number,
  random: () => number,
): { matches: GeneratedRotationMatch[]; idleCourtPenalty: number } {
  const remaining = [...matches]
  const optimalTwoCourtBatches = courtCount === 2
    ? buildOptimalTwoCourtBatches(matches, generatedMatchPlayerIds, random)
    : null
  const remainingBatches = optimalTwoCourtBatches ? [...optimalTwoCourtBatches] : null
  const lastPlayed = new Map<string, number>()
  const ordered: GeneratedRotationMatch[] = []
  let idleCourtPenalty = 0
  let roundNumber = 0

  while (remaining.length > 0) {
    const targetSize = Math.min(courtCount, remaining.length)
    const ranked = remaining
      .map((match) => {
        const players = generatedMatchPlayerIds(match)
        const rests = players.map((playerId) => {
          const last = lastPlayed.get(playerId)
          return last == null ? roundNumber + 2 : roundNumber - last - 1
        })
        return {
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
    let batch: Omit<GeneratedRotationMatch, 'sequenceNumber'>[]
    if (remainingBatches) {
      remainingBatches.sort((first, second) => {
        if (first.length !== second.length) return second.length - first.length
        const firstRank = Math.min(...first.map((match) => ranked.findIndex((item) => item.match === match)))
        const secondRank = Math.min(...second.map((match) => ranked.findIndex((item) => item.match === match)))
        return firstRank - secondRank
      })
      batch = remainingBatches.shift()!
    } else {
      const selection = findCompatibleBatch(
        ranked.map(({ match }) => match),
        targetSize,
        generatedMatchPlayerIds,
      )
      batch = selection.batch.length > 0 ? selection.batch : [ranked[0]!.match]
    }
    idleCourtPenalty += targetSize - batch.length

    for (const match of batch) {
      remaining.splice(remaining.indexOf(match), 1)
      ordered.push({ ...match, sequenceNumber: ordered.length + 1 })
      for (const playerId of generatedMatchPlayerIds(match)) {
        lastPlayed.set(playerId, roundNumber)
      }
    }
    roundNumber += 1
  }

  return { matches: ordered, idleCourtPenalty }
}

function evaluateSchedule(
  matches: GeneratedRotationMatch[],
  playerIds: readonly string[],
  courtCount: number,
): Pick<CandidateSchedule, 'opponentPenalty' | 'consecutivePenalty'> {
  const opponentCounts = new Map<string, number>()
  const lastPlayed = new Map<string, number>()
  let consecutivePenalty = 0

  matches.forEach((match, index) => {
    const roundNumber = Math.floor(index / courtCount)
    const teams = [match.teamAPlayerIds, match.teamBPlayerIds] as const
    for (const first of teams[0]) {
      for (const second of teams[1]) {
        const key = opponentKey(first, second)
        opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1)
      }
    }
    for (const playerId of [...teams[0], ...teams[1]]) {
      if (lastPlayed.get(playerId) === roundNumber - 1) consecutivePenalty += 1
      lastPlayed.set(playerId, roundNumber)
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

  if (playerIds.length === 10 && matchesPerPlayer === 6 && courtCount === 2) {
    const assignedPlayers = shuffle(playerIds, mulberry32(seed))
    return OPTIMIZED_TEN_PLAYER_TEMPLATE.map(([teamA, teamB], index) => ({
      sequenceNumber: index + 1,
      teamAPlayerIds: [assignedPlayers[teamA[0]]!, assignedPlayers[teamA[1]]!],
      teamBPlayerIds: [assignedPlayers[teamB[0]]!, assignedPlayers[teamB[1]]!],
    }))
  }

  let best: CandidateSchedule | null = null
  const partnershipCount = (playerIds.length * matchesPerPlayer) / 2
  const qualityAttempts = Math.max(48, Math.min(120, playerIds.length * 8))
  const attempts = partnershipCount <= 80 ? qualityAttempts : partnershipCount <= 250 ? 16 : 8
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const random = mulberry32((seed + Math.imul(attempt + 1, 0x9e3779b1)) >>> 0)
    const paired = playerIds.length % 2 === 0
      ? pairEvenPartnershipRoundsIntoMatches(
          createEvenPartnershipRounds(playerIds, matchesPerPlayer, random),
          random,
        )
      : pairPartnershipsIntoMatches(
          createPartnerships(playerIds, matchesPerPlayer, random),
          random,
        )
    if (!paired) continue
    const ordered = orderMatches(paired, courtCount, random)
    const score = evaluateSchedule(ordered.matches, playerIds, courtCount)
    const candidate = { ...ordered, ...score }
    if (
      !best ||
      candidate.idleCourtPenalty < best.idleCourtPenalty ||
      (candidate.idleCourtPenalty === best.idleCourtPenalty &&
        candidate.opponentPenalty < best.opponentPenalty) ||
      (candidate.idleCourtPenalty === best.idleCourtPenalty &&
        candidate.opponentPenalty === best.opponentPenalty &&
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

function rotationPlannedBatches(
  matches: readonly RotationMatch[],
  courtCount: number,
): RotationMatch[][] {
  if (!Number.isInteger(courtCount) || courtCount < 1) return []

  const batches: RotationMatch[][] = []
  let batch: RotationMatch[] = []
  let batchPlayerIds = new Set<string>()
  for (const match of [...matches].sort((a, b) => a.sequence_number - b.sequence_number)) {
    const playerIds = matchPlayerIds(match)
    if (
      batch.length >= courtCount ||
      playerIds.some((playerId) => batchPlayerIds.has(playerId))
    ) {
      batches.push(batch)
      batch = []
      batchPlayerIds = new Set()
    }
    batch.push(match)
    for (const playerId of playerIds) batchPlayerIds.add(playerId)
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

function rotationPlannedBatchIndexes(
  matches: readonly RotationMatch[],
  courtCount: number,
) {
  const indexes = new Map<string, number>()
  rotationPlannedBatches(matches, courtCount).forEach((batch, index) => {
    for (const match of batch) indexes.set(match.id, index)
  })
  return indexes
}

export function getNextRotationPlannedRound(
  matches: readonly RotationMatch[],
  courtCount: number,
): { roundNumber: number; matches: RotationMatch[] } | null {
  if (!Number.isInteger(courtCount) || courtCount < 1) return null
  const batches = rotationPlannedBatches(matches, courtCount)
  const batchIndex = batches.findIndex((batch) =>
    batch.some((match) => match.status !== 'completed'),
  )
  if (batchIndex < 0) return null
  return {
    roundNumber: batchIndex + 1,
    matches: batches[batchIndex]!,
  }
}

export function isRotationPlannedRestRound(
  matches: readonly RotationMatch[],
  courtCount: number,
): boolean {
  const plannedRound = getNextRotationPlannedRound(matches, courtCount)
  return Boolean(plannedRound && plannedRound.matches.length < courtCount)
}

export function getRotationPlannedRestRoundMatchIds(
  matches: readonly RotationMatch[],
  courtCount: number,
): Set<string> {
  return new Set(
    rotationPlannedBatches(matches, courtCount)
      .filter((batch) => batch.length < courtCount)
      .flatMap((batch) => batch.map((match) => match.id)),
  )
}

export function getRotationStartableMatchIds(
  matches: readonly RotationMatch[],
  courtCount: number,
): Set<string> {
  const playingMatches = matches.filter((match) => match.status === 'playing')
  const playingPlayerIds = new Set(playingMatches.flatMap(matchPlayerIds))
  const eligibleMatches = matches.filter(
    (match) =>
      match.status === 'available' &&
      matchPlayerIds(match).every((playerId) => !playingPlayerIds.has(playerId)),
  )
  const openCourtCount = Math.max(0, courtCount - playingMatches.length)
  const targetSize = Math.min(openCourtCount, eligibleMatches.length)
  if (targetSize <= 1) return new Set(eligibleMatches.map((match) => match.id))

  const startableIds = new Set<string>()
  for (const match of eligibleMatches) {
    const completion = findCompatibleBatch(
      eligibleMatches.filter((candidate) => candidate.id !== match.id),
      targetSize - 1,
      matchPlayerIds,
      matchPlayerIds(match),
    )
    if (completion.batch.length === targetSize - 1 || completion.truncated) {
      startableIds.add(match.id)
    }
  }

  return startableIds.size > 0
    ? startableIds
    : new Set(eligibleMatches.map((match) => match.id))
}

export function recommendRotationMatch(
  matches: readonly RotationMatch[],
  players: readonly RotationPlayer[],
  courtCount = 1,
): RotationMatch | null {
  const playingMatches = matches.filter((match) => match.status === 'playing')
  const playingPlayers = new Set(playingMatches.flatMap(matchPlayerIds))
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

  const eligibleMatches = matches.filter(
    (match) =>
      match.status === 'available' &&
      matchPlayerIds(match).every((playerId) => !playingPlayers.has(playerId)),
  )
  const openCourtCount = Math.max(
    1,
    courtCount - playingMatches.length,
  )
  const startableMatchIds = getRotationStartableMatchIds(matches, courtCount)
  const plannedBatchIndexes = rotationPlannedBatchIndexes(matches, courtCount)
  const playingBatches = new Set(
    playingMatches.map((match) => plannedBatchIndexes.get(match.id)),
  )
  const preferredBatch = courtCount > 1
    ? playingBatches.size === 1
      ? [...playingBatches][0]!
      : playingBatches.size === 0
        ? Math.min(
            ...eligibleMatches.map((match) => plannedBatchIndexes.get(match.id) ?? Infinity),
          )
        : null
    : null

  return (
    eligibleMatches
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
          keepsCourtsMoving: openCourtCount <= 1 || startableMatchIds.has(match.id),
          followsPlannedBatch:
            preferredBatch == null ||
            plannedBatchIndexes.get(match.id) === preferredBatch,
          appearanceSpread: Math.max(...projected) - Math.min(...projected),
          backToBack: rests.filter((rest) => rest === 0).length,
          minimumRest: Math.min(...rests),
          totalRest: rests.reduce((sum, rest) => sum + rest, 0),
        }
      })
      .sort(
        (a, b) =>
          Number(b.keepsCourtsMoving) - Number(a.keepsCourtsMoving) ||
          Number(b.followsPlannedBatch) - Number(a.followsPlannedBatch) ||
          a.appearanceSpread - b.appearanceSpread ||
          a.backToBack - b.backToBack ||
          b.minimumRest - a.minimumRest ||
          b.totalRest - a.totalRest ||
          a.match.sequence_number - b.match.sequence_number,
      )[0]?.match ?? null
  )
}
