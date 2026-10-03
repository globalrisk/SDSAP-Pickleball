import { supabase } from './supabase'
import { fetchAllPages } from './pagination'
import { type LeagueDuelDraft } from './leagueTeamDuel'
import type { SeasonFormat, TeamWithPlayers } from '../types'
import { fetchPlayerPool, fetchTeamsWithPlayers } from './api'
import { generateLeagueDuelDrafts } from './leagueTeamDuel'
import { buildTierMatchedDuelSchedule, compareDuelPlayers } from './leagueDuelSchedule'
import { partnershipKey } from './balanceTeams'

export async function setSeasonFormat(seasonId: string, format: SeasonFormat): Promise<void> {
  const { error } = await supabase.rpc('set_season_format_atomic', { p_season_id: seasonId, p_format: format })
  if (error) throw error
}

export async function clearUnplayedLeagueDuelFixtures(seasonId: string, expectedMatchIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('clear_unplayed_league_duel_fixtures_atomic', {
    p_season_id: seasonId, p_expected_match_ids: expectedMatchIds,
  })
  if (error) throw error
  return data as number
}

export async function fetchLeagueDuelDraftContext(leagueId: string, seasonId: string) {
  const [revision, history] = await Promise.all([
    supabase.rpc('league_duel_rating_snapshot', { p_league_id: leagueId }),
    supabase.rpc('league_duel_partner_history', { p_season_id: seasonId }),
  ])
  if (revision.error) throw revision.error
  if (history.error) throw history.error
  const previous = history.data as { leagueId: string; seasonIds: string[]; partnerships: Array<{ poolPlayerIds: [string, string]; seasonIds: string[] }> } | null
  if (!previous || previous.leagueId !== leagueId || !Array.isArray(previous.seasonIds) || !Array.isArray(previous.partnerships)) {
    throw new Error('Previous partnership history could not be loaded.')
  }
  const partnerHistory = previous.seasonIds.map((id) => new Set(previous.partnerships
    .filter((pair) => pair.seasonIds.includes(id)).map((pair) => partnershipKey(...pair.poolPlayerIds))))
  const snapshot = revision.data as { revision: number; fingerprint: string } | null
  if (!snapshot) throw new Error('League rating state was not found')
  return { revision: snapshot.revision, fingerprint: snapshot.fingerprint, partnerHistory, historySeasonIds: previous.seasonIds }
}

export async function fetchLeagueDuelDraftPreview(leagueId: string, seasonId: string, rosterIds: string[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const context = await fetchLeagueDuelDraftContext(leagueId, seasonId)
    const pool = await fetchPlayerPool(leagueId)
    const { data: after, error } = await supabase.rpc('league_duel_rating_snapshot', { p_league_id: leagueId })
    if (error) throw error
    if (after?.revision !== context.revision || after?.fingerprint !== context.fingerprint) continue
    const ids = new Set(rosterIds)
    const selected = pool.filter((p) => ids.has(p.id))
    if (ids.size !== rosterIds.length || selected.length !== rosterIds.length) throw new Error('Every selected player must belong to this league.')
    return { ...context, drafts: generateLeagueDuelDrafts(selected, context.partnerHistory) }
  }
  throw new Error('DUEL_STALE_DRAFT: League ratings changed. Refresh draft options first.')
}

export async function saveLeagueDuelDraft(seasonId: string, draft: LeagueDuelDraft, names: [string, string], revision: number, fingerprint: string): Promise<void> {
  const { error } = await supabase.rpc('save_league_duel_draft_atomic', {
    p_season_id: seasonId, p_expected_rating_revision: revision,
    p_expected_rating_fingerprint: fingerprint,
    p_squads: draft.squads.map((players, i) => ({ name: names[i].trim(), color: i === 0 ? '#15803d' : '#1d4ed8', poolPlayerIds: players.map((p) => p.id) })),
  })
  if (error) throw error
}

export async function generateLeagueDuelSeasonMatches(seasonId: string): Promise<number> {
  const season = await supabase.from('seasons').select('league_id, duel_schedule_mode').eq('id', seasonId).single()
  if (season.error) throw season.error
  if (season.data.duel_schedule_mode !== 'tier_matched') throw new Error('DUEL_STALE_DRAFT: Refresh and save a tier-matched draft first.')
  const snapshot = await supabase.rpc('league_duel_rating_snapshot', { p_league_id: season.data.league_id })
  if (snapshot.error) throw snapshot.error
  if (!snapshot.data) throw new Error('League rating state was not found')
  const [teams, pool, fixtures] = await Promise.all([
    fetchTeamsWithPlayers(seasonId), fetchPlayerPool(season.data.league_id),
    fetchAllPages((from, to) => supabase.from('matches').select('id').eq('season_id', seasonId).order('id').range(from, to)),
  ])
  if (fixtures.error) throw fixtures.error
  if (fixtures.data?.length) throw new Error('This season already has matches')
  if (teams.length !== 2) throw new Error('Save two squads first')
  const byId = new Map(pool.map((player) => [player.id, player]))
  const ratedSquad = (team: TeamWithPlayers) => team.players.map((player) => {
    const rated = byId.get(player.pool_player_id)
    if (!rated) throw new Error('DUEL_STALE_DRAFT: A squad player is no longer available.')
    return rated
  }).sort(compareDuelPlayers)
  const rated = teams.map(ratedSquad)
  if (compareDuelPlayers(rated[0]![0]!, rated[1]![0]!) > 0) { teams.reverse(); rated.reverse() }
  const schedule = buildTierMatchedDuelSchedule([rated[0]!, rated[1]!])
  const { data, error } = await supabase.rpc('generate_league_duel_matches_atomic', {
    p_season_id: seasonId, p_expected_rating_revision: snapshot.data.revision,
    p_expected_rating_fingerprint: snapshot.data.fingerprint,
    p_matches: schedule.games.map((game) => ({ ...game, homeTeamId: teams[0]!.id, awayTeamId: teams[1]!.id })),
  })
  if (error) throw error
  return data as number
}
