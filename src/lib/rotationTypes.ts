export type RotationEventStatus = 'draft' | 'active' | 'completed'
export type RotationMatchStatus = 'available' | 'playing' | 'completed'

export interface RotationEvent {
  id: string
  name: string
  matches_per_player: number
  court_count: number
  schedule_seed: number
  status: RotationEventStatus
  created_at: string
  updated_at: string
}

export interface RotationPlayer {
  id: string
  event_id: string
  name: string
  display_order: number
  created_at: string
  updated_at?: string
}

export interface RotationMatch {
  id: string
  event_id: string
  sequence_number: number
  team_a_player_1_id: string
  team_a_player_2_id: string
  team_b_player_1_id: string
  team_b_player_2_id: string
  status: RotationMatchStatus
  court_number: number | null
  team_a_score: number | null
  team_b_score: number | null
  result_recorded_at: string | null
  revision: number
  created_at: string
  updated_at: string
}

export interface RotationSnapshot {
  event: RotationEvent
  players: RotationPlayer[]
  matches: RotationMatch[]
}

export interface GeneratedRotationMatch {
  sequenceNumber: number
  teamAPlayerIds: [string, string]
  teamBPlayerIds: [string, string]
}

export interface RotationStanding {
  rank: number
  playerId: string
  name: string
  played: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  pointDifferential: number
  opponentsWinRate: number
}
