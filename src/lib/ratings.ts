import { GLICKO2_DEFAULTS, updateGlicko2Player, type Glicko2Rating } from './glicko2'

import type { PlayerRankingRow } from '../types'

export interface VirtualGame {
  playerId: string
  opponentId: string
  score: number
}

export interface DoublesMatchPlayers {
  winnerPoolIds: [string, string]
  loserPoolIds: [string, string]
}

export function expandDoublesResult(
  winnerPoolIds: [string, string],
  loserPoolIds: [string, string],
): VirtualGame[] {
  const games: VirtualGame[] = []

  for (const winnerId of winnerPoolIds) {
    for (const loserId of loserPoolIds) {
      games.push({ playerId: winnerId, opponentId: loserId, score: 1 })
      games.push({ playerId: loserId, opponentId: winnerId, score: 0 })
    }
  }

  return games
}

export function createDefaultRatingsMap(poolIds: string[]): Map<string, Glicko2Rating> {
  const map = new Map<string, Glicko2Rating>()
  for (const id of poolIds) {
    map.set(id, { ...GLICKO2_DEFAULTS })
  }
  return map
}

export function createInitialRatingsMap(
  pool: { id: string; initial_rating: number }[],
): Map<string, Glicko2Rating> {
  const map = new Map<string, Glicko2Rating>()
  for (const player of pool) {
    map.set(player.id, {
      rating: player.initial_rating,
      rd: GLICKO2_DEFAULTS.rd,
      volatility: GLICKO2_DEFAULTS.volatility,
    })
  }
  return map
}

export function applyDoublesMatchToRatings(
  ratings: Map<string, Glicko2Rating>,
  match: DoublesMatchPlayers,
): void {
  const { winnerPoolIds, loserPoolIds } = match
  const participantIds = [...winnerPoolIds, ...loserPoolIds]

  const snapshots = new Map<string, Glicko2Rating>()
  for (const id of participantIds) {
    const current = ratings.get(id) ?? { ...GLICKO2_DEFAULTS }
    snapshots.set(id, { ...current })
    if (!ratings.has(id)) {
      ratings.set(id, { ...current })
    }
  }

  const virtualGames = expandDoublesResult(winnerPoolIds, loserPoolIds)
  const gamesByPlayer = new Map<string, { opponent: Glicko2Rating; score: number }[]>()

  for (const game of virtualGames) {
    const opponent = snapshots.get(game.opponentId)!
    const list = gamesByPlayer.get(game.playerId) ?? []
    list.push({ opponent, score: game.score })
    gamesByPlayer.set(game.playerId, list)
  }

  for (const playerId of participantIds) {
    const current = snapshots.get(playerId)!
    const games = gamesByPlayer.get(playerId) ?? []
    ratings.set(playerId, updateGlicko2Player(current, games))
  }
}

export function buildRankingRows(
  pool: { id: string; name: string; rating: number; rating_deviation: number; volatility: number }[],
): PlayerRankingRow[] {
  const sorted = [...pool].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating
    return a.name.localeCompare(b.name)
  })

  return sorted.map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    rating: player.rating,
    ratingDeviation: player.rating_deviation,
    volatility: player.volatility,
  }))
}

export function roundRating(value: number): number {
  return Math.round(value)
}
