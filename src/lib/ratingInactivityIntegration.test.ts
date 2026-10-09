import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
import { buildPreMatchRatings } from './historicalRatings'
import { buildRatingsReplacement } from './ratingRepository'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { createSeasonMatches, recordResult, recomputeAllRatings, recordForfeit, revertMatchToScheduled } from './api'
import { fetchLeagueDuelDraftPreview, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { saveSeasonRoster } from './seasonRosterApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
beforeAll(async () => {
  api = await startLocalSupabase()
  state.client = createClient(api.url, 'local-anon-key', {
    global: { headers: { Authorization: `Bearer ${api.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}, 20000)
afterAll(async () => { await api?.close() })

describe('elapsed absence through result saves and atomic PostgreSQL rebuilds', () => {
  it('learns from returning players with grown pre-game uncertainty and handles correction, rebuild, forfeit, and undo', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    await setSeasonFormat(seasonId, 'team_duel')
    await saveSeasonRoster(seasonId, players.slice(0, 8).map(p => p.id))
    const preview = await fetchLeagueDuelDraftPreview(leagueId, seasonId, [])
    await saveLeagueDuelDraft(seasonId, preview.drafts[0]!, ['A', 'B'], preview.revision, preview.fingerprint)
    await createSeasonMatches(seasonId)
    const games = (await api.db.query<{
      id: string; home_team_id: string; away_team_id: string; home_pool_player_ids: string[]
    }>('SELECT * FROM public.matches WHERE season_id = $1 ORDER BY id', [seasonId])).rows
    const first = games[0]!
    const playerId = first.home_pool_player_ids[0]!
    const returning = games.find(m => m.id !== first.id && m.home_pool_player_ids.includes(playerId))!
    const now = new Date()
    const beforeWeeks = (weeks: number) => new Date(now.getTime() - weeks * 7 * 86400000).toISOString()
    // Preserve historical original entry dates, as the app does when correcting results.
    await api.db.query('UPDATE public.matches SET result_recorded_at = $1 WHERE id = $2', [beforeWeeks(6), first.id])
    await recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 5 })
    const firstHistory = (await api.db.query<{ rating_deviation: number }>(
      'SELECT rating_deviation FROM public.rating_history WHERE league_id = $1 AND pool_player_id = $2 AND match_id = $3',
      [leagueId, playerId, first.id],
    )).rows[0]!
    await api.db.query('UPDATE public.matches SET result_recorded_at = $1 WHERE id = $2', [beforeWeeks(4), returning.id])
    await recordResult(returning.id, { winnerTeamId: returning.home_team_id, homeScore: 11, awayScore: 6 })
    const replacement = await buildRatingsReplacement(state.client!, leagueId)
    expect(buildPreMatchRatings(replacement.historyRows).get(`${returning.id}:${playerId}`)!.rd)
      .toBeCloseTo(Math.sqrt(firstHistory.rating_deviation ** 2 + 25 ** 2), 12)
    const current = async () => (await api.db.query(
      'SELECT pool_player_id, rating, rating_deviation FROM public.league_players WHERE league_id = $1 ORDER BY pool_player_id', [leagueId],
    )).rows
    const before = await current()
    await recomputeAllRatings(leagueId)
    expect(await current()).toEqual(before)
    await recordResult(returning.id, { winnerTeamId: returning.away_team_id, homeScore: 6, awayScore: 11 })
    const date = (await api.db.query<{ result_recorded_at: string }>('SELECT result_recorded_at FROM public.matches WHERE id = $1', [returning.id])).rows[0]!
    expect(new Date(date.result_recorded_at).toISOString()).toBe(beforeWeeks(4))
    await revertMatchToScheduled(returning.id)
    const undone = await current()
    await recordForfeit(returning.id, returning.home_team_id, returning.home_team_id, returning.away_team_id)
    expect(await current()).toEqual(undone)
    const history = (await api.db.query<{ match_id: string | null }>('SELECT match_id FROM public.rating_history WHERE league_id = $1', [leagueId])).rows
    expect(new Set(history.flatMap(r => r.match_id ? [r.match_id] : []))).toEqual(new Set([first.id]))
  }, 20000)
})
