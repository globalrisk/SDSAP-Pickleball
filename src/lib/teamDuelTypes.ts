export type TeamDuelSquadStatus = 'active' | 'archived'
export type TeamDuelEventStatus = 'draft' | 'active' | 'tiebreak_required' | 'completed'
export type TeamDuelMatchStatus = 'available' | 'playing' | 'completed'
export type TeamDuelMatchKind = 'standard' | 'tiebreak'
export type TeamDuelSide = 'a' | 'b'

export interface TeamDuelRegisteredPlayer {
  id: string
  name: string
  status: 'active' | 'inactive'
}

export interface TeamDuelSquadMember {
  squad_id: string
  rank_position: number
  pool_player_id: string
  created_at: string
  player_name: string
}

export interface TeamDuelSquad {
  id: string
  name: string
  status: TeamDuelSquadStatus
  revision: number
  created_at: string
  updated_at: string
  members: TeamDuelSquadMember[]
}

export interface TeamDuelEvent {
  id: string
  event_date: string
  title: string | null
  squad_a_id: string
  squad_b_id: string
  squad_a_name: string | null
  squad_b_name: string | null
  roster_size: number | null
  court_count: number
  status: TeamDuelEventStatus
  revision: number
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
}

export interface TeamDuelEventPlayer {
  id: string
  event_id: string
  side: TeamDuelSide
  rank_position: number
  pool_player_id: string | null
  display_name: string
  created_at: string
}

export interface TeamDuelMatch {
  id: string
  event_id: string
  kind: TeamDuelMatchKind
  round_number: number
  sequence_number: number
  team_a_rank_1: number
  team_a_rank_2: number
  team_b_rank_1: number
  team_b_rank_2: number
  status: TeamDuelMatchStatus
  court_number: number | null
  team_a_score: number | null
  team_b_score: number | null
  result_recorded_at: string | null
  revision: number
  created_at: string
  updated_at: string
}

export interface TeamDuelSnapshot {
  event: TeamDuelEvent
  players: TeamDuelEventPlayer[]
  matches: TeamDuelMatch[]
}

export interface GeneratedTeamDuelMatch {
  roundNumber: number
  sequenceNumber: number
  rankPair: readonly [number, number]
}

export interface GeneratedTeamDuelRound {
  roundNumber: number
  byeRank: number | null
  matches: GeneratedTeamDuelMatch[]
}

export interface TeamDuelScore {
  teamA: number
  teamB: number
  completed: number
  total: number
}
