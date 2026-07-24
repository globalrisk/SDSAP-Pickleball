export type MatchStatus = 'scheduled' | 'completed' | 'forfeit'
export type SeasonStatus = 'active' | 'archived'

export interface Season {
  id: string
  name: string
  status: SeasonStatus
  starts_at: string
  ends_at: string | null
  created_at: string
}

export interface Team {
  id: string
  season_id: string
  name: string
  color: string
  created_at: string
}

export interface PoolPlayer {
  id: string
  name: string
  rating: number
  rating_deviation: number
  volatility: number
  initial_rating: number
  created_at: string
}

export interface PlayerRankingRow {
  rank: number
  id: string
  name: string
  rating: number
  ratingDeviation: number
  volatility: number
}

export interface RatingHistoryPoint {
  id: string
  matchId: string | null
  rating: number
  ratingDeviation: number
  recordedAt: string
  sequence: number
  roundNumber: number | null
  seasonId: string | null
  seasonName: string | null
  seasonStartsAt: string | null
  resultRecordedAt: string | null
  result: 'W' | 'L' | null
  partnerName: string | null
  opponentNames: string[]
  scoreLabel: string | null
}

export interface PlayerFunStats {
  currentStreak: { result: 'W' | 'L'; count: number } | null
  bestPartner: { name: string; wins: number; played: number } | null
  toughestOpponent: {
    name: string
    lossesAgainst: number
    played: number
  } | null
  biggestSwing: { delta: number } | null
}

export interface PlayerProfile {
  id: string
  name: string
  rating: number
  ratingDeviation: number
  initialRating: number
  rank: number
  played: number
  wins: number
  losses: number
  winRate: number
  form: ('W' | 'L')[]
  ratingDelta: number
  history: RatingHistoryPoint[]
  funStats: PlayerFunStats
}

export interface Player {
  id: string
  name: string
  team_id: string
  pool_player_id: string
  created_at: string
}

export interface TeamWithPlayers extends Team {
  players: Player[]
}

export interface Match {
  id: string
  season_id: string
  home_team_id: string
  away_team_id: string
  status: MatchStatus
  home_score: number | null
  away_score: number | null
  winner_team_id: string | null
  round_number: number
  home_pool_player_ids: string[] | null
  away_pool_player_ids: string[] | null
  result_recorded_at: string | null
  created_at: string
}

export interface MatchWithTeams extends Match {
  home_team: Pick<Team, 'id' | 'name' | 'color'> & {
    players?: (Pick<Player, 'name' | 'pool_player_id'> & {
      rating?: number
      ratingDeviation?: number
    })[]
  }
  away_team: Pick<Team, 'id' | 'name' | 'color'> & {
    players?: (Pick<Player, 'name' | 'pool_player_id'> & {
      rating?: number
      ratingDeviation?: number
    })[]
  }
  winner: Pick<Team, 'id' | 'name' | 'color'> | null
}

export interface StandingRow {
  rank: number
  team: Team
  playerNames: string[]
  players: { name: string; poolPlayerId: string }[]
  played: number
  wins: number
  losses: number
  points: number
}
