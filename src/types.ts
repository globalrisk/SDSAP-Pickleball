export type MatchStatus = 'scheduled' | 'completed' | 'forfeit'
export type MatchLiveStatus = 'available' | 'playing' | 'up_next'
export type SeasonStatus = 'active' | 'archived'
export type PoolPlayerStatus = 'active' | 'inactive'

export interface Season {
  id: string
  name: string
  status: SeasonStatus
  starts_at: string
  ends_at: string | null
  created_at: string
  live_court_count: number
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
  status: PoolPlayerStatus
  rating: number
  rating_deviation: number
  volatility: number
  initial_rating: number
  created_at: string
}

export interface PlayerTitle {
  id: string
  whyParams: Record<string, string | number>
}

export interface PlayerRankingRow {
  rank: number | null
  id: string
  name: string
  status: PoolPlayerStatus
  rating: number
  ratingDeviation: number
  conservativeRating: number
  matchesPlayed: number
  provisional: boolean
  volatility: number
  title: PlayerTitle | null
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
  biggestSwing: {
    delta: number
    result: 'W' | 'L' | null
    partnerName: string | null
    opponentNames: string[]
    scoreLabel: string | null
    seasonName: string | null
    resultRecordedAt: string | null
  } | null
}

export interface PlayerMatchEvent {
  matchId: string
  seasonId: string
  seasonName: string | null
  result: 'W' | 'L'
  partnerPoolId: string | null
  partnerName: string | null
  opponentPoolIds: string[]
  opponentNames: string[]
  scoreLabel: string | null
  resultRecordedAt: string | null
  homeTeamId: string
  awayTeamId: string
  winnerTeamId: string
  onHome: boolean
}

export interface PlayerRivalry {
  opponentId: string
  opponentName: string
  wins: number
  losses: number
  played: number
  winRate: number
  longestWinStreak: number
  latestMeeting: {
    matchId: string
    result: 'W' | 'L'
    date: string | null
    partnerName: string | null
    scoreLabel: string | null
    seasonName: string | null
  }
}

export interface PlayerRivalries {
  nemesis: PlayerRivalry | null
  favoriteOpponent: PlayerRivalry | null
  byOpponent: PlayerRivalry[]
}

export interface SeasonRecapTeamAward {
  teamId: string
  teamName: string
  color: string
  rank: number
  wins: number
  losses: number
  points: number
  playerNames: string[]
  players: { name: string; poolPlayerId: string }[]
}

export interface SeasonRecapPlayerAward {
  playerId: string
  playerName: string
  detailParams: Record<string, string | number>
}

export interface SeasonRecapUpset {
  matchId: string
  winnerTeamName: string
  loserTeamName: string
  scoreLabel: string | null
  winnerPercent: number
  resultRecordedAt: string | null
}

export interface SeasonRecap {
  seasonId: string
  seasonName: string
  isPartial: boolean
  champions: SeasonRecapTeamAward[]
  runnersUp: SeasonRecapTeamAward[]
  biggestUpset: SeasonRecapUpset | null
  mostImproved: SeasonRecapPlayerAward | null
  bestPartnership: SeasonRecapTeamAward | null
  mvp: SeasonRecapPlayerAward | null
}

export interface PlayerProfile {
  id: string
  name: string
  rating: number
  ratingDeviation: number
  initialRating: number
  rank: number | null
  provisional: boolean
  played: number
  wins: number
  losses: number
  winRate: number
  form: ('W' | 'L')[]
  ratingDelta: number
  history: RatingHistoryPoint[]
  funStats: PlayerFunStats
  title: PlayerTitle | null
  rivalries: PlayerRivalries
}

export interface Player {
  id: string
  name: string
  team_id: string
  pool_player_id: string
  created_at: string
  is_present: boolean
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
  live_status: MatchLiveStatus
  live_court_number: number | null
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
    players?: (Pick<Player, 'name' | 'pool_player_id' | 'is_present'> & {
      rating?: number
      ratingDeviation?: number
    })[]
  }
  away_team: Pick<Team, 'id' | 'name' | 'color'> & {
    players?: (Pick<Player, 'name' | 'pool_player_id' | 'is_present'> & {
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
