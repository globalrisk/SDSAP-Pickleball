import { supabase } from './supabase'
import { fetchAllPages } from './pagination'
import { countRecentSquadmates, type LeagueDuelDraft } from './leagueTeamDuel'
import type { SeasonFormat, TeamWithPlayers } from '../types'
import { fetchPlayerPool } from './api'
import { generateLeagueDuelDrafts } from './leagueTeamDuel'

export async function setSeasonFormat(seasonId: string, format: SeasonFormat): Promise<void> {
  const { error } = await supabase.rpc('set_season_format_atomic', { p_season_id: seasonId, p_format: format })
  if (error) throw error
}

export async function fetchLeagueDuelDraftContext(leagueId: string) {
  const [revision, seasons] = await Promise.all([
    supabase.rpc('league_duel_rating_snapshot', { p_league_id: leagueId }),
    fetchAllPages((from, to) => supabase.from('seasons')
      .select('id, teams(*, players(*)), matches(status)')
      .eq('league_id', leagueId).eq('format', 'team_duel')
      .order('starts_at', { ascending: false }).order('id').range(from, to)),
  ])
  if (revision.error) throw revision.error
  if (seasons.error) throw seasons.error
  const completed = (seasons.data ?? []).filter((season) => season.matches.length > 0 && season.matches.every((m) => m.status !== 'scheduled'))
  const snapshot = revision.data as { revision: number; fingerprint: string } | null
  if (!snapshot) throw new Error('League rating state was not found')
  return { revision: snapshot.revision, fingerprint: snapshot.fingerprint,
    squadmateCounts: countRecentSquadmates(completed.slice(0, 3).map((season) => season.teams as TeamWithPlayers[])) }
}

export async function fetchLeagueDuelDraftPreview(leagueId: string, rosterIds: string[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const context = await fetchLeagueDuelDraftContext(leagueId)
    const pool = await fetchPlayerPool(leagueId)
    const { data: after, error } = await supabase.rpc('league_duel_rating_snapshot', { p_league_id: leagueId })
    if (error) throw error
    if (after?.revision !== context.revision || after?.fingerprint !== context.fingerprint) continue
    const ids = new Set(rosterIds)
    return { ...context, drafts: generateLeagueDuelDrafts(pool.filter((p) => ids.has(p.id)), context.squadmateCounts) }
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
  const { data, error } = await supabase.rpc('generate_league_duel_matches_atomic', { p_season_id: seasonId })
  if (error) throw error
  return data as number
}
