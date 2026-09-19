import { supabase } from './supabase'
import { createRotationId } from './rotationId'
import { flattenTeamDuelSchedule } from './teamDuelSchedule'
import type {
  TeamDuelEvent,
  TeamDuelEventPlayer,
  TeamDuelMatch,
  TeamDuelRegisteredPlayer,
  TeamDuelSnapshot,
  TeamDuelSquad,
  TeamDuelSquadMember,
} from './teamDuelTypes'

export const teamDuelSquadsQueryKey = ['team-duel', 'squads'] as const
export const teamDuelEventsQueryKey = (includeDrafts: boolean) =>
  ['team-duel', 'events', includeDrafts] as const
export const teamDuelSnapshotQueryKey = (eventId: string | undefined) =>
  ['team-duel', 'snapshot', eventId] as const
export const teamDuelPlayersQueryKey = ['team-duel', 'registered-players'] as const

interface SquadRow extends Omit<TeamDuelSquad, 'members'> {
  team_duel_squad_members?: Array<{
    squad_id: string
    rank_position: number
    pool_player_id: string
    created_at: string
    player_pool: { name: string } | Array<{ name: string }> | null
  }>
}

function playerNameFromRelation(
  relation: { name: string } | Array<{ name: string }> | null,
): string {
  if (Array.isArray(relation)) return relation[0]?.name ?? '—'
  return relation?.name ?? '—'
}

function mapSquad(row: SquadRow): TeamDuelSquad {
  const members: TeamDuelSquadMember[] = (row.team_duel_squad_members ?? [])
    .map((member) => ({
      squad_id: member.squad_id,
      rank_position: member.rank_position,
      pool_player_id: member.pool_player_id,
      created_at: member.created_at,
      player_name: playerNameFromRelation(member.player_pool),
    }))
    .toSorted((first, second) => first.rank_position - second.rank_position)
  const { team_duel_squad_members: _members, ...squad } = row
  return { ...squad, members }
}

export async function fetchTeamDuelRegisteredPlayers(): Promise<TeamDuelRegisteredPlayer[]> {
  const { data, error } = await supabase
    .from('player_pool')
    .select('id,name,status')
    .eq('status', 'active')
    .order('name')
  if (error) throw error
  return (data ?? []) as TeamDuelRegisteredPlayer[]
}

export async function fetchTeamDuelSquads(): Promise<TeamDuelSquad[]> {
  const { data, error } = await supabase
    .from('team_duel_squads')
    .select('*,team_duel_squad_members(*,player_pool(name))')
    .order('name')
  if (error) throw error
  return ((data ?? []) as unknown as SquadRow[]).map(mapSquad)
}

export async function saveTeamDuelSquad(input: {
  id?: string
  name: string
  poolPlayerIds: string[]
  expectedRevision?: number
}): Promise<string> {
  const id = input.id ?? createRotationId()
  const { data, error } = await supabase.rpc('save_team_duel_squad_atomic', {
    p_squad_id: id,
    p_name: input.name.trim(),
    p_pool_player_ids: input.poolPlayerIds,
    p_expected_revision: input.expectedRevision ?? 0,
  })
  if (error) throw error
  return data as string
}

export async function setTeamDuelSquadArchived(
  squad: Pick<TeamDuelSquad, 'id' | 'revision'>,
  archived: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_team_duel_squad_archived_atomic', {
    p_squad_id: squad.id,
    p_archived: archived,
    p_expected_revision: squad.revision,
  })
  if (error) throw error
}

export async function deleteTeamDuelSquad(
  squad: Pick<TeamDuelSquad, 'id' | 'revision'>,
): Promise<void> {
  const { error } = await supabase.rpc('delete_team_duel_squad_atomic', {
    p_squad_id: squad.id,
    p_expected_revision: squad.revision,
  })
  if (error) throw error
}

export async function fetchTeamDuelEvents(includeDrafts: boolean): Promise<TeamDuelEvent[]> {
  let query = supabase
    .from('team_duel_events')
    .select('*')
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (!includeDrafts) query = query.neq('status', 'draft')
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as TeamDuelEvent[]
}

export async function saveTeamDuelDraft(input: {
  id?: string
  eventDate: string
  title: string
  squadAId: string
  squadBId: string
  courtCount: number
  expectedRevision?: number
}): Promise<string> {
  const id = input.id ?? createRotationId()
  const { data, error } = await supabase.rpc('save_team_duel_draft_atomic', {
    p_event_id: id,
    p_event_date: input.eventDate,
    p_title: input.title.trim() || null,
    p_squad_a_id: input.squadAId,
    p_squad_b_id: input.squadBId,
    p_court_count: input.courtCount,
    p_expected_revision: input.expectedRevision ?? 0,
  })
  if (error) throw error
  return data as string
}

export async function deleteTeamDuelDraft(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_team_duel_draft_atomic', {
    p_event_id: eventId,
  })
  if (error) throw error
}

export async function deleteTeamDuelHistory(
  event: Pick<TeamDuelEvent, 'id' | 'revision'>,
): Promise<void> {
  const { error } = await supabase.rpc('delete_team_duel_history_atomic', {
    p_event_id: event.id,
    p_expected_revision: event.revision,
  })
  if (error) throw error
}

export async function activateTeamDuelEvent(event: TeamDuelEvent, rosterSize: number): Promise<void> {
  const schedule = flattenTeamDuelSchedule(rosterSize).map((match) => ({
    round_number: match.roundNumber,
    sequence_number: match.sequenceNumber,
    rank_1: match.rankPair[0],
    rank_2: match.rankPair[1],
  }))
  const { error } = await supabase.rpc('activate_team_duel_event_atomic', {
    p_event_id: event.id,
    p_expected_revision: event.revision,
    p_matches: schedule,
  })
  if (error) throw error
}

export async function fetchTeamDuelSnapshot(eventId: string): Promise<TeamDuelSnapshot> {
  const eventPromise = supabase.from('team_duel_events').select('*').eq('id', eventId).single()
  const playersPromise = supabase
    .from('team_duel_event_players')
    .select('*')
    .eq('event_id', eventId)
    .order('side')
    .order('rank_position')
  const matchesPromise = supabase
    .from('team_duel_matches')
    .select('*')
    .eq('event_id', eventId)
    .order('sequence_number')
  const [eventResult, playersResult, matchesResult] = await Promise.all([
    eventPromise,
    playersPromise,
    matchesPromise,
  ])
  if (eventResult.error) throw eventResult.error
  if (playersResult.error) throw playersResult.error
  if (matchesResult.error) throw matchesResult.error
  return {
    event: eventResult.data as TeamDuelEvent,
    players: (playersResult.data ?? []) as TeamDuelEventPlayer[],
    matches: (matchesResult.data ?? []) as TeamDuelMatch[],
  }
}

export async function startTeamDuelMatch(
  match: Pick<TeamDuelMatch, 'id' | 'revision'>,
  courtNumber: number,
): Promise<void> {
  const { error } = await supabase.rpc('start_team_duel_match_atomic', {
    p_match_id: match.id,
    p_court_number: courtNumber,
    p_expected_revision: match.revision,
  })
  if (error) throw error
}

export async function returnTeamDuelMatchToQueue(
  match: Pick<TeamDuelMatch, 'id' | 'revision'>,
): Promise<void> {
  const { error } = await supabase.rpc('return_team_duel_match_to_queue_atomic', {
    p_match_id: match.id,
    p_expected_revision: match.revision,
  })
  if (error) throw error
}

export async function saveTeamDuelResult(
  match: Pick<TeamDuelMatch, 'id' | 'revision'>,
  teamAScore: number,
  teamBScore: number,
): Promise<void> {
  const { error } = await supabase.rpc('save_team_duel_result_atomic', {
    p_match_id: match.id,
    p_team_a_score: teamAScore,
    p_team_b_score: teamBScore,
    p_expected_revision: match.revision,
  })
  if (error) throw error
}

export async function createTeamDuelTiebreak(input: {
  event: Pick<TeamDuelEvent, 'id' | 'revision'>
  teamARanks: readonly [number, number]
  teamBRanks: readonly [number, number]
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_team_duel_tiebreak_atomic', {
    p_event_id: input.event.id,
    p_team_a_rank_1: input.teamARanks[0],
    p_team_a_rank_2: input.teamARanks[1],
    p_team_b_rank_1: input.teamBRanks[0],
    p_team_b_rank_2: input.teamBRanks[1],
    p_expected_revision: input.event.revision,
  })
  if (error) throw error
  return data as string
}
