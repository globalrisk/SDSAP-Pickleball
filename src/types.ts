export type MatchStatus = 'scheduled' | 'completed' | 'forfeit'

export interface Team {
  id: string
  name: string
  color: string
  created_at: string
}

export interface Player {
  id: string
  name: string
  team_id: string
  created_at: string
}

export interface TeamWithPlayers extends Team {
  players: Player[]
}

export interface Match {
  id: string
  home_team_id: string
  away_team_id: string
  scheduled_at: string
  status: MatchStatus
  home_score: number | null
  away_score: number | null
  winner_team_id: string | null
  round_number: number
  created_at: string
}

export interface MatchWithTeams extends Match {
  home_team: Pick<Team, 'id' | 'name' | 'color'>
  away_team: Pick<Team, 'id' | 'name' | 'color'>
  winner: Pick<Team, 'id' | 'name' | 'color'> | null
}

export interface StandingRow {
  rank: number
  team: Team
  played: number
  wins: number
  losses: number
  points: number
}
