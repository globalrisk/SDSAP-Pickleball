import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { archiveSeason, createSeason, createSeasonMatches, fetchMatches, fetchPlayerProfile, fetchPlayerRankings, fetchSeasonRecap, recomputeAllRatings, recordForfeit, recordResult, revertMatchToScheduled } from './api'
import { fetchLeagueDuelDraftPreview, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { replayRatings, type FinishedMatchForRatings } from './ratingReplay'
import { saveSeasonRoster } from './seasonRosterApi'
import { computeStandings } from './standings'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
beforeAll(async () => {
  api = await startLocalSupabase()
  state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
}, 20000)
afterAll(async () => { await api?.close() })

describe('rated league duel through the application API and PostgreSQL', () => {
  it('saves, retries, corrects, undoes and forfeits while matching canonical replay and individual history', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    await setSeasonFormat(seasonId, 'team_duel')
    const preview = await fetchLeagueDuelDraftPreview(leagueId, players.map((p) => p.id))
    expect(preview.drafts).toHaveLength(3)
    await saveLeagueDuelDraft(seasonId, preview.drafts[0]!, ['Green squad', 'Blue squad'], preview.revision, preview.fingerprint)
    expect(await createSeasonMatches(seasonId)).toBe(21)
    const matches = await fetchMatches(seasonId, leagueId)
    expect(matches.every((m) => m.home_team.players?.length === 2 && m.away_team.players?.length === 2)).toBe(true)
    const first = matches[0]!, second = matches[1]!
    await expect(recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 10 })).rejects.toThrow()
    await recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 7 })
    api.conflictOnNextSave()
    await recordResult(second.id, { winnerTeamId: second.away_team_id, homeScore: 6, awayScore: 11 })
    expect(api.calls.filter((c) => c.name === 'save_match_and_ratings_atomic')).toHaveLength(3)

    const canonical = async () => {
      const pool = (await api.db.query<{ id: string; initial_rating: number }>('SELECT pool_player_id AS id, initial_rating FROM public.league_players WHERE league_id = $1 ORDER BY pool_player_id', [leagueId])).rows
      const finished = (await api.db.query<FinishedMatchForRatings>(`SELECT match.*, season.starts_at::text AS season_starts_at,
        (SELECT jsonb_agg(jsonb_build_object('pool_player_id', player.pool_player_id)) FROM public.players AS player WHERE player.team_id = match.home_team_id) AS home_players,
        (SELECT jsonb_agg(jsonb_build_object('pool_player_id', player.pool_player_id)) FROM public.players AS player WHERE player.team_id = match.away_team_id) AS away_players
        FROM public.matches AS match JOIN public.seasons AS season ON season.id = match.season_id
        WHERE season.league_id = $1 AND match.status = 'completed' ORDER BY season.starts_at, match.result_recorded_at, match.id`, [leagueId])).rows
      const expected = replayRatings({ pool, finishedMatches: finished, seasonRosters: new Map([[seasonId, players.map((p) => p.id)]]), recordedAt: '2026-10-01' })
      const actual = (await api.db.query<{ id: string; rating: number; rating_deviation: number; volatility: number }>('SELECT pool_player_id AS id, rating, rating_deviation, volatility FROM public.league_players WHERE league_id = $1 ORDER BY pool_player_id', [leagueId])).rows
      expect(actual).toEqual(expected.playerRatings)
      const history = (await api.db.query<{ pool_player_id: string; match_id: string | null; rating: number; rating_deviation: number; sequence: number }>('SELECT pool_player_id, match_id, rating, rating_deviation, sequence FROM public.rating_history WHERE league_id = $1 ORDER BY sequence', [leagueId])).rows
      expect(history).toEqual(expected.historyRows.map(({ recorded_at: _ignored, ...row }) => row))
      return actual
    }
    await canonical()
    await recordResult(first.id, { winnerTeamId: first.away_team_id, homeScore: 9, awayScore: 11 })
    await canonical()
    await revertMatchToScheduled(first.id)
    await canonical()
    const restored = (await fetchMatches(seasonId, leagueId)).find((m) => m.id === first.id)!
    expect(restored.home_pool_player_ids).toEqual(first.home_pool_player_ids)
    expect(restored.away_pool_player_ids).toEqual(first.away_pool_player_ids)
    const ratingsBeforeForfeit = await canonical()
    await recordForfeit(first.id, first.home_team_id, first.home_team_id, first.away_team_id)
    expect(await canonical()).toEqual(ratingsBeforeForfeit)
    await revertMatchToScheduled(first.id)
    await canonical()
    for (const match of matches.filter((m) => m.id !== second.id)) await recordResult(match.id, { winnerTeamId: match.home_team_id, homeScore: 11, awayScore: 6 })
    // Concurrent requests share a revision; the stale SQL commit must retry
    // with the other saved game included in the canonical history.
    await revertMatchToScheduled(first.id)
    await revertMatchToScheduled(second.id)
    const concurrentStart = api.calls.length
    await Promise.all([
      recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 6 }),
      recordResult(second.id, { winnerTeamId: second.away_team_id, homeScore: 6, awayScore: 11 }),
    ])
    expect(api.calls.slice(concurrentStart).filter((c) => c.name === 'save_match_and_ratings_atomic').length).toBeGreaterThan(2)
    const allRatings = await canonical()
    // A retry of the same saved result cannot create an extra history event.
    await recordResult(second.id, { winnerTeamId: second.away_team_id, homeScore: 6, awayScore: 11 })
    expect(await canonical()).toEqual(allRatings)
    await recomputeAllRatings(leagueId)
    expect(await canonical()).toEqual(allRatings)
    const rankings = await fetchPlayerRankings(leagueId)
    expect(rankings.every((p) => p.matchesPlayed === 6 && !p.provisional)).toBe(true)
    const profile = await fetchPlayerProfile(leagueId, players[0]!.id)
    expect(profile?.played).toBe(6)
    const recap = await fetchSeasonRecap(seasonId, leagueId)
    expect(recap).toMatchObject({ format: 'team_duel', isPartial: false, bestPartnership: null })
    expect(recap.champions).toHaveLength(1)
    expect(recap.mostImproved).not.toBeNull()
  }, 30000)

  it('finishes equal game wins as joint champions despite unequal point differential', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    await archiveSeason(seasonId)
    const season = await createSeason('Joint champions', leagueId, 'team_duel')
    const rosterIds = players.slice(0, 8).map((player) => player.id)
    await saveSeasonRoster(season.id, rosterIds)
    const preview = await fetchLeagueDuelDraftPreview(leagueId, rosterIds)
    expect(preview.squadmateCounts.size).toBe(42)
    await saveLeagueDuelDraft(season.id, preview.drafts[0]!, ['Joint A', 'Joint B'], preview.revision, preview.fingerprint)
    expect(await createSeasonMatches(season.id)).toBe(6)
    const matches = await fetchMatches(season.id, leagueId)
    for (const [index, match] of matches.entries()) {
      await recordResult(match.id, index < 3
        ? { winnerTeamId: match.home_team_id, homeScore: 11, awayScore: 0 }
        : { winnerTeamId: match.away_team_id, homeScore: 9, awayScore: 11 })
    }
    const finished = await fetchMatches(season.id, leagueId)
    const teams = (await state.client!.from('teams').select('*, players(*)').eq('season_id', season.id)).data!
    expect(computeStandings(teams, finished, 'team_duel').map((row) => row.rank)).toEqual([1, 1])
    await archiveSeason(season.id)
    const recap = await fetchSeasonRecap(season.id, leagueId)
    expect(recap.champions.map((champion) => champion.teamName).sort()).toEqual(['Joint A', 'Joint B'])
    expect(recap).toMatchObject({ format: 'team_duel', isPartial: false, bestPartnership: null })
  }, 20000)
})
