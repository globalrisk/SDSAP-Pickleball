import { calculateMatchProbability } from './matchProbability'
import {
  chronologicalMatchPoints,
  computeCurrentStreak,
  computePlayerFunStats,
} from './engagement'
import { roundRating } from './ratings'
import type { RatingHistoryPoint } from '../types'

export type PlayerTitleId =
  | 'on_fire'
  | 'ice_cold'
  | 'silver_forever'
  | 'almost_there'
  | 'giant_killer'
  | 'climbing'
  | 'free_fall'
  | 'loyal_duo'
  | 'closer'
  | 'blowout'
  | 'iron'
  | 'wildcard'

export interface PlayerTitle {
  id: PlayerTitleId
  /** Values for i18n `titles.{id}.why` */
  whyParams: Record<string, string | number>
}

export interface TitlePlayerStats {
  id: string
  name: string
  played: number
  wins: number
  ratingDelta: number
  currentStreak: { result: 'W' | 'L'; count: number } | null
  bestPartner: { name: string; wins: number; played: number } | null
  secondPlaceSeasons: number
  firstPlaceSeasons: number
  underdogWins: number
  favoriteLosses: number
  closeWins: number
  blowoutWins: number
  biggestAbsSwing: number
}

interface MatchForTitles {
  id: string
  winner_team_id: string | null
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
  home_pool_player_ids: string[] | null
  away_pool_player_ids: string[] | null
  homePlayers: { id: string; name: string; rating: number; rd: number }[]
  awayPlayers: { id: string; name: string; rating: number; rd: number }[]
}

interface SeasonFinish {
  seasonId: string
  /** pool_player_id → finishing rank (1 = champion) */
  ranks: Map<string, number>
}

const MIN_PLAYED_FOR_RATING_TITLES = 5
const MIN_PARTNER_GAMES = 3
const UNDERDOG_MAX = 0.4
const FAVORITE_MIN = 0.65

export function buildTitlePlayerStats(args: {
  id: string
  name: string
  rating: number
  initialRating: number
  history: RatingHistoryPoint[]
  matches: MatchForTitles[]
  seasonFinishes: SeasonFinish[]
}): TitlePlayerStats {
  const { id, name, rating, initialRating, history, matches, seasonFinishes } =
    args
  const fun = computePlayerFunStats(history)
  const chrono = chronologicalMatchPoints(history)

  let wins = 0
  let closeWins = 0
  let blowoutWins = 0
  let underdogWins = 0
  let favoriteLosses = 0

  for (const match of matches) {
    const homeIds = match.home_pool_player_ids ?? match.homePlayers.map((p) => p.id)
    const awayIds = match.away_pool_player_ids ?? match.awayPlayers.map((p) => p.id)
    const onHome = homeIds.includes(id)
    const onAway = awayIds.includes(id)
    if (!onHome && !onAway) continue
    if (!match.winner_team_id) continue

    const won =
      (onHome && match.winner_team_id === match.home_team_id) ||
      (!onHome && match.winner_team_id === match.away_team_id)
    if (won) wins += 1

    const margin =
      match.home_score != null && match.away_score != null
        ? Math.abs(match.home_score - match.away_score)
        : null
    if (won && margin != null && margin <= 2) closeWins += 1
    if (won && margin != null && margin >= 5) blowoutWins += 1

    const probability = calculateMatchProbability(
      {
        players: match.homePlayers.map((p) => ({
          rating: p.rating,
          ratingDeviation: p.rd,
        })),
      },
      {
        players: match.awayPlayers.map((p) => ({
          rating: p.rating,
          ratingDeviation: p.rd,
        })),
      },
    )
    if (probability) {
      const myWinChance = onHome ? probability.home : probability.away
      if (won && myWinChance < UNDERDOG_MAX) underdogWins += 1
      if (!won && myWinChance >= FAVORITE_MIN) favoriteLosses += 1
    }
  }

  let firstPlaceSeasons = 0
  let secondPlaceSeasons = 0
  for (const finish of seasonFinishes) {
    const rank = finish.ranks.get(id)
    if (rank === 1) firstPlaceSeasons += 1
    if (rank === 2) secondPlaceSeasons += 1
  }

  let biggestAbsSwing = 0
  if (fun.biggestSwing) {
    biggestAbsSwing = Math.abs(fun.biggestSwing.delta)
  } else {
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]!
      const curr = history[i]!
      if (!curr.matchId) continue
      biggestAbsSwing = Math.max(biggestAbsSwing, Math.abs(curr.rating - prev.rating))
    }
  }

  return {
    id,
    name,
    played: chrono.length,
    wins,
    ratingDelta: rating - initialRating,
    currentStreak: fun.currentStreak ?? computeCurrentStreak(chrono.map((p) => p.result!)),
    bestPartner: fun.bestPartner,
    secondPlaceSeasons,
    firstPlaceSeasons,
    underdogWins,
    favoriteLosses,
    closeWins,
    blowoutWins,
    biggestAbsSwing,
  }
}

type TitleDef = {
  id: PlayerTitleId
  eligible: (p: TitlePlayerStats) => boolean
  score: (p: TitlePlayerStats) => number
  whyParams: (p: TitlePlayerStats) => Record<string, string | number>
}

const TITLE_DEFS: TitleDef[] = [
  {
    id: 'on_fire',
    eligible: (p) => p.currentStreak?.result === 'W' && p.currentStreak.count >= 3,
    score: (p) => p.currentStreak?.count ?? 0,
    whyParams: (p) => ({ count: p.currentStreak?.count ?? 0 }),
  },
  {
    id: 'ice_cold',
    eligible: (p) => p.currentStreak?.result === 'L' && p.currentStreak.count >= 3,
    score: (p) => p.currentStreak?.count ?? 0,
    whyParams: (p) => ({ count: p.currentStreak?.count ?? 0 }),
  },
  {
    id: 'silver_forever',
    eligible: (p) => p.secondPlaceSeasons >= 2,
    score: (p) => p.secondPlaceSeasons,
    whyParams: (p) => ({ count: p.secondPlaceSeasons }),
  },
  {
    id: 'almost_there',
    eligible: (p) => p.secondPlaceSeasons >= 1 && p.firstPlaceSeasons === 0,
    score: (p) => p.secondPlaceSeasons * 10 + p.favoriteLosses,
    whyParams: (p) => ({ count: p.secondPlaceSeasons }),
  },
  {
    id: 'giant_killer',
    eligible: (p) => p.underdogWins >= 2,
    score: (p) => p.underdogWins,
    whyParams: (p) => ({ count: p.underdogWins }),
  },
  {
    id: 'climbing',
    eligible: (p) => p.played >= MIN_PLAYED_FOR_RATING_TITLES && p.ratingDelta > 20,
    score: (p) => p.ratingDelta,
    whyParams: (p) => ({ delta: formatSigned(p.ratingDelta) }),
  },
  {
    id: 'free_fall',
    eligible: (p) => p.played >= MIN_PLAYED_FOR_RATING_TITLES && p.ratingDelta < -20,
    score: (p) => -p.ratingDelta,
    whyParams: (p) => ({ delta: formatSigned(p.ratingDelta) }),
  },
  {
    id: 'loyal_duo',
    eligible: (p) =>
      !!p.bestPartner &&
      p.bestPartner.played >= MIN_PARTNER_GAMES &&
      p.bestPartner.wins / p.bestPartner.played >= 0.65,
    score: (p) => {
      const partner = p.bestPartner!
      return partner.wins / partner.played + partner.played * 0.01
    },
    whyParams: (p) => ({
      partner: p.bestPartner!.name,
      wins: p.bestPartner!.wins,
      played: p.bestPartner!.played,
    }),
  },
  {
    id: 'closer',
    eligible: (p) => p.closeWins >= 2,
    score: (p) => p.closeWins,
    whyParams: (p) => ({ count: p.closeWins }),
  },
  {
    id: 'blowout',
    eligible: (p) => p.blowoutWins >= 2,
    score: (p) => p.blowoutWins,
    whyParams: (p) => ({ count: p.blowoutWins }),
  },
  {
    id: 'iron',
    eligible: (p) => p.played >= 8,
    score: (p) => p.played,
    whyParams: (p) => ({ count: p.played }),
  },
  {
    id: 'wildcard',
    eligible: (p) => p.played >= MIN_PLAYED_FOR_RATING_TITLES && p.biggestAbsSwing >= 40,
    score: (p) => p.biggestAbsSwing,
    whyParams: (p) => ({ swing: roundRating(p.biggestAbsSwing) }),
  },
]

function formatSigned(delta: number): string {
  const rounded = roundRating(delta)
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

/**
 * Assign at most one unique title per player, greedily by title priority.
 */
export function assignPlayerTitles(
  players: TitlePlayerStats[],
): Map<string, PlayerTitle> {
  const assigned = new Map<string, PlayerTitle>()
  const takenPlayers = new Set<string>()

  for (const def of TITLE_DEFS) {
    const candidates = players
      .filter((p) => !takenPlayers.has(p.id) && def.eligible(p))
      .sort((a, b) => {
        const scoreDiff = def.score(b) - def.score(a)
        if (scoreDiff !== 0) return scoreDiff
        return a.name.localeCompare(b.name)
      })

    const winner = candidates[0]
    if (!winner) continue

    assigned.set(winner.id, {
      id: def.id,
      whyParams: def.whyParams(winner),
    })
    takenPlayers.add(winner.id)
  }

  return assigned
}
