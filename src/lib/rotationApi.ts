import { supabase } from './supabase'
import { createRotationId } from './rotationId'
import type {
  GeneratedRotationMatch,
  RotationEvent,
  RotationMatch,
  RotationPlayer,
  RotationSnapshot,
} from './rotationTypes'

export const rotationSnapshotQueryKey = ['rotation', 'snapshot'] as const

export async function fetchRotationSnapshot(): Promise<RotationSnapshot | null> {
  const { data: event, error: eventError } = await supabase
    .from('rotation_events')
    .select('*')
    .limit(1)
    .maybeSingle()
  if (eventError) throw eventError
  if (!event) return null

  const [playersResult, matchesResult] = await Promise.all([
    supabase
      .from('rotation_players')
      .select('*')
      .eq('event_id', event.id)
      .order('display_order'),
    supabase
      .from('rotation_matches')
      .select('*')
      .eq('event_id', event.id)
      .order('sequence_number'),
  ])
  if (playersResult.error) throw playersResult.error
  if (matchesResult.error) throw matchesResult.error
  return {
    event: event as RotationEvent,
    players: (playersResult.data ?? []) as RotationPlayer[],
    matches: (matchesResult.data ?? []) as RotationMatch[],
  }
}

export async function replaceRotationEvent(input: {
  name: string
  playerNames: string[]
  matchesPerPlayer: number
  courtCount: number
  seed: number
  schedule: GeneratedRotationMatch[]
}): Promise<string> {
  const eventId = createRotationId()
  const playerIds = new Map<string, string>()
  const players = input.playerNames.map((name, displayOrder) => {
    const sourceId = `player-${displayOrder + 1}`
    const id = createRotationId()
    playerIds.set(sourceId, id)
    return { id, name: name.trim(), display_order: displayOrder }
  })
  const matches = input.schedule.map((match) => ({
    id: createRotationId(),
    sequence_number: match.sequenceNumber,
    team_a_player_1_id: playerIds.get(match.teamAPlayerIds[0]),
    team_a_player_2_id: playerIds.get(match.teamAPlayerIds[1]),
    team_b_player_1_id: playerIds.get(match.teamBPlayerIds[0]),
    team_b_player_2_id: playerIds.get(match.teamBPlayerIds[1]),
  }))
  if (matches.some((match) => Object.values(match).some((value) => value == null))) {
    throw new Error('Generated schedule contains an unknown player.')
  }

  const { data, error } = await supabase.rpc('replace_rotation_event_atomic', {
    p_event_id: eventId,
    p_name: input.name.trim(),
    p_matches_per_player: input.matchesPerPlayer,
    p_court_count: input.courtCount,
    p_schedule_seed: input.seed,
    p_players: players,
    p_matches: matches,
  })
  if (error) throw error
  return data as string
}

export async function startRotationMatch(
  matchId: string,
  courtNumber: number,
  expectedRevision: number,
): Promise<void> {
  const { error } = await supabase.rpc('start_rotation_match_atomic', {
    p_match_id: matchId,
    p_court_number: courtNumber,
    p_expected_revision: expectedRevision,
  })
  if (error) throw error
}

export async function returnRotationMatchToQueue(
  matchId: string,
  expectedRevision: number,
): Promise<void> {
  const { error } = await supabase.rpc('return_rotation_match_to_queue_atomic', {
    p_match_id: matchId,
    p_expected_revision: expectedRevision,
  })
  if (error) throw error
}

export async function saveRotationResult(
  matchId: string,
  teamAScore: number,
  teamBScore: number,
  expectedRevision: number,
): Promise<void> {
  const { error } = await supabase.rpc('save_rotation_match_result_atomic', {
    p_match_id: matchId,
    p_team_a_score: teamAScore,
    p_team_b_score: teamBScore,
    p_expected_revision: expectedRevision,
  })
  if (error) throw error
}

export async function resetRotationEvent(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('reset_rotation_event_atomic', {
    p_event_id: eventId,
  })
  if (error) throw error
}
