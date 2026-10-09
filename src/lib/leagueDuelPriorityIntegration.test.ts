/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
import { readFile } from 'node:fs/promises'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { fetchMatches, fetchPlayerPool, fetchSeasons, fetchTeamsWithPlayers } from './api'
import { clearUnplayedLeagueDuelFixtures, fetchLeagueDuelDraftPreview, generateLeagueDuelSeasonMatches, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { createDuelDraftOptions, refreshDuelDraftOptions, isSelectedDuelDraftSaved } from './duelDraftOptions'
import { saveSeasonRoster } from './seasonRosterApi'
import { forecastLeagueDuelSeason, isSeasonForecastBalanced } from './seasonForecast'
import { buildTierMatchedDuelSchedule, compareDuelPlayers } from './leagueDuelSchedule'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
beforeEach(async () => {
  api = await startLocalSupabase()
  state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
}, 20000)
afterEach(async () => { await api?.close() })

async function prepare() {
  const seed = api.seeded!
  await setSeasonFormat(seed.seasonId, 'team_duel')
  const preview = await fetchLeagueDuelDraftPreview(seed.leagueId, seed.seasonId, seed.players.map((player) => player.id))
  return { ...seed, preview }
}

describe('saved optimization priorities through PostgreSQL and the application API', () => {
  it('reloads the server roster even when the caller still has the previous roster', async () => {
    const setup = await prepare()
    const previousIds = setup.players.map((player) => player.id)
    await saveSeasonRoster(setup.seasonId, previousIds.slice(0, 12))
    const refreshed = await fetchLeagueDuelDraftPreview(setup.leagueId, setup.seasonId, previousIds)
    expect(refreshed.rosterIds.toSorted()).toEqual(previousIds.slice(0, 12).toSorted())
    expect(refreshed.snapshotKey).not.toBe(setup.preview.snapshotKey)
    expect(refreshed.drafts.every((draft) => draft.squads.every((squad) => squad.length === 6))).toBe(true)
  })
  it.each(['balance', 'opponent_variety'] as const)('refreshes, saves, reloads, and generates the exact %s preview', async (priority) => {
    const setup = await prepare()
    const unchanged = (await api.db.query('SELECT to_jsonb(m) data FROM public.matches m WHERE season_id <> $1 ORDER BY id', [setup.seasonId])).rows
    const initial = createDuelDraftOptions(setup.preview.snapshotKey, setup.preview.candidates)
    const options = refreshDuelDraftOptions(initial, setup.preview.snapshotKey, setup.preview.candidates)
    const chosen = options.drafts.find((draft) => draft.priority === priority)!
    expect(isSeasonForecastBalanced(chosen.schedule.seasonForecast)).toBe(true)
    await saveLeagueDuelDraft(setup.seasonId, chosen, ['Saved A', 'Saved B'], setup.preview.revision, setup.preview.fingerprint)
    const season = (await fetchSeasons(setup.leagueId)).find((season) => season.id === setup.seasonId)!
    expect(season.duel_draft_priority).toBe(priority)
    const teams = await fetchTeamsWithPlayers(setup.seasonId)
    expect(isSelectedDuelDraftSaved(chosen, season, teams, setup.preview)).toBe(true)
    const reloaded = await fetchLeagueDuelDraftPreview(setup.leagueId, setup.seasonId, setup.players.map((player) => player.id))
    const saved = reloaded.candidates[priority].find((draft) => draft.id === chosen.id)!
    expect(createDuelDraftOptions(reloaded.snapshotKey, reloaded.candidates, saved).drafts.find((draft) => draft.priority === priority)).toEqual(chosen)
    expect(await generateLeagueDuelSeasonMatches(setup.seasonId)).toBe(21)
    const fixtures = await fetchMatches(setup.seasonId, setup.leagueId)
    expect(fixtures.map((match) => ({ roundNumber: match.round_number, sequenceNumber: match.duel_sequence_number,
      homePoolPlayerIds: match.home_pool_player_ids, awayPoolPlayerIds: match.away_pool_player_ids }))).toEqual(chosen.schedule.games)
    const forecast = forecastLeagueDuelSeason(fixtures, [fixtures[0]!.home_team_id, fixtures[0]!.away_team_id])!
    expect(forecast.homeWinProbability).toBeCloseTo(chosen.schedule.seasonForecast.homeWinProbability, 12)
    expect(forecast.expectedHomeWins).toBeCloseTo(chosen.schedule.seasonForecast.expectedHomeWins, 12)
    const roster = teams.flatMap(team => team.players)
    for (const home of chosen.squads[0]) for (const away of chosen.squads[1]) {
      const tierCap = (id: string) => roster.find(player => player.pool_player_id === id)!.duel_tier === 'middle' ? 3 : 4
      const meetings = fixtures.filter(match => match.home_pool_player_ids!.includes(home.id) && match.away_pool_player_ids!.includes(away.id)).length
      expect(meetings).toBeLessThanOrEqual(Math.min(tierCap(home.id), tierCap(away.id)))
    }
    expect((await api.db.query('SELECT to_jsonb(m) data FROM public.matches m WHERE season_id <> $1 ORDER BY id', [setup.seasonId])).rows).toEqual(unchanged)
    const alternate = priority === 'balance' ? 'opponent_variety' : 'balance'
    expect((await state.client!.from('seasons').update({ duel_draft_priority: alternate }).eq('id', setup.seasonId)).error?.message).toContain('frozen')
    expect((await state.client!.from('seasons').update({ duel_draft_rating_revision: null }).eq('id', setup.seasonId)).error?.message).toContain('frozen')
    await clearUnplayedLeagueDuelFixtures(setup.seasonId, fixtures.map((match) => match.id))
    expect((await fetchSeasons(setup.leagueId)).find((season) => season.id === setup.seasonId)?.duel_draft_priority).toBeNull()
  }, 30000)

  it('rejects a priority-only generation race with no partial fixtures', async () => {
    const setup = await prepare()
    const draft = setup.preview.drafts[0]!
    await saveLeagueDuelDraft(setup.seasonId, draft, ['A', 'B'], setup.preview.revision, setup.preview.fingerprint)
    const teams = await fetchTeamsWithPlayers(setup.seasonId)
    const home = teams.find((team) => team.players.some((p) => p.pool_player_id === draft.squads[0][0]!.id))!
    const away = teams.find((team) => team.id !== home.id)!
    await state.client!.from('seasons').update({ duel_draft_priority: 'opponent_variety' }).eq('id', setup.seasonId)
    const result = await state.client!.rpc('generate_league_duel_matches_atomic', {
      p_season_id: setup.seasonId, p_expected_rating_revision: setup.preview.revision,
      p_expected_rating_fingerprint: setup.preview.fingerprint, p_expected_draft_priority: 'balance',
      p_matches: draft.schedule.games.map((game) => ({ ...game, homeTeamId: home.id, awayTeamId: away.id })),
    })
    expect(result.error?.code).toBe('40001')
    expect(result.error?.message).toContain('priority changed')
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toEqual([])
  })

  it.each(['balance', 'opponent_variety'] as const)('rejects saving an out-of-bound %s forecast without changing saved squads', async (priority) => {
    const setup = await prepare()
    const draft = setup.preview.drafts.find(draft => draft.priority === priority)!
    await saveLeagueDuelDraft(setup.seasonId, draft, ['A', 'B'], setup.preview.revision, setup.preview.fingerprint)
    const before = await fetchTeamsWithPlayers(setup.seasonId)
    const ineligible = { ...draft, schedule: { ...draft.schedule, seasonForecast: {
      ...draft.schedule.seasonForecast, homeWinProbability: 0.55000001, awayWinProbability: 0.44999999,
    } } }
    await expect(saveLeagueDuelDraft(setup.seasonId, ineligible, ['Changed A', 'Changed B'], setup.preview.revision, setup.preview.fingerprint)).rejects.toThrow('DUEL_SEASON_BALANCE')
    expect(await fetchTeamsWithPlayers(setup.seasonId)).toEqual(before)
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toEqual([])
  })

  it.each(['balance', 'opponent_variety'] as const)('rejects generating an older out-of-bound %s draft without creating fixtures', async (priority) => {
    const setup = await prepare()
    await api.db.query('UPDATE public.league_players SET rating = 800, rating_deviation = 20 WHERE league_id = $1', [setup.leagueId])
    await api.db.query('UPDATE public.league_players SET rating = 5000 WHERE league_id = $1 AND pool_player_id = $2', [setup.leagueId, setup.players[0]!.id])
    const fresh = await fetchLeagueDuelDraftPreview(setup.leagueId, setup.seasonId, [])
    expect(fresh.candidates).toEqual({ balance: [], opponent_variety: [] })
    // A tier-compatible legacy split: two of four top players, three of six
    // middle players, and two of four bottom players per squad.
    const rated = (await fetchPlayerPool(setup.leagueId)).sort(compareDuelPlayers)
    const selected = new Set([0, 2, 4, 6, 8, 10, 12])
    const squads: [typeof rated, typeof rated] = [rated.filter((_, i) => selected.has(i)), rated.filter((_, i) => !selected.has(i))]
    expect(isSeasonForecastBalanced(buildTierMatchedDuelSchedule(squads, priority).seasonForecast)).toBe(false)
    // Emulate an older client that saved before the new frontend limit.
    const result = await state.client!.rpc('save_league_duel_draft_atomic', {
      p_season_id: setup.seasonId, p_expected_rating_revision: fresh.revision, p_expected_rating_fingerprint: fresh.fingerprint, p_priority: priority,
      p_squads: squads.map((squad, i) => ({ name: `Older ${i}`, color: '#15803d', poolPlayerIds: squad.map(p => p.id) })),
    })
    expect(result.error).toBeNull()
    const before = await fetchTeamsWithPlayers(setup.seasonId)
    await expect(generateLeagueDuelSeasonMatches(setup.seasonId)).rejects.toThrow('DUEL_SEASON_BALANCE')
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toEqual([])
    expect(await fetchTeamsWithPlayers(setup.seasonId)).toEqual(before)
  })

  it('defaults omitted priorities for legacy callers and rejects invalid or anonymous saves', async () => {
    const setup = await prepare()
    const draft = setup.preview.drafts[1]!
    const args = { p_season_id: setup.seasonId, p_expected_rating_revision: setup.preview.revision,
      p_expected_rating_fingerprint: setup.preview.fingerprint,
      p_squads: draft.squads.map((squad, i) => ({ name: `Legacy ${i}`, color: '#15803d', poolPlayerIds: squad.map((p) => p.id) })) }
    expect((await state.client!.rpc('save_league_duel_draft_atomic', args)).error).toBeNull()
    expect((await fetchSeasons(setup.leagueId)).find((season) => season.id === setup.seasonId)?.duel_draft_priority).toBe('opponent_variety')
    const before = await fetchTeamsWithPlayers(setup.seasonId)
    for (const priority of ['invalid', null]) expect((await state.client!.rpc('save_league_duel_draft_atomic', { ...args, p_priority: priority })).error?.code).toBe('23514')
    expect(await fetchTeamsWithPlayers(setup.seasonId)).toEqual(before)
    state.client = createClient(api.url, 'local-anon-key', { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await state.client.rpc('save_league_duel_draft_atomic', { ...args, p_priority: 'balance' })).error?.code).toBe('42501')
  })

  it('clears the priority when roster or format invalidates the draft', async () => {
    const setup = await prepare()
    await saveLeagueDuelDraft(setup.seasonId, setup.preview.drafts[0]!, ['A', 'B'], setup.preview.revision, setup.preview.fingerprint)
    await saveSeasonRoster(setup.seasonId, setup.players.map((p) => p.id))
    expect((await fetchSeasons(setup.leagueId)).find((season) => season.id === setup.seasonId)?.duel_draft_priority).toBeNull()
    await saveLeagueDuelDraft(setup.seasonId, setup.preview.drafts[0]!, ['A', 'B'], setup.preview.revision, setup.preview.fingerprint)
    await setSeasonFormat(setup.seasonId, 'round_robin')
    expect((await fetchSeasons(setup.leagueId)).find((season) => season.id === setup.seasonId)?.duel_draft_priority).toBeNull()
  })
})

describe('priority migration over saved legacy drafts', () => {
  it('preserves populated records and defaults NULL priority to opponent variety', async () => {
    await api.close()
    const filename = '20261009132125_league_duel_draft_priorities.sql'
    api = await startLocalSupabase({ beforeMigration: filename })
    state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { leagueId, seasonId, players } = api.seeded!
    await setSeasonFormat(seasonId, 'team_duel')
    // Save through the old signature, before the new column exists.
    const snapshot = (await state.client.rpc('league_duel_rating_snapshot', { p_league_id: leagueId })).data!
    const squads = [players.filter((_, i) => i % 2 === 0), players.filter((_, i) => i % 2 === 1)]
    expect((await state.client.rpc('save_league_duel_draft_atomic', {
      p_season_id: seasonId, p_expected_rating_revision: snapshot.revision, p_expected_rating_fingerprint: snapshot.fingerprint,
      p_squads: squads.map((squad, i) => ({ name: `Old ${i}`, color: '#15803d', poolPlayerIds: squad.map((p) => p.id) })),
    })).error).toBeNull()
    const stored = async () => (await api.db.query("SELECT to_jsonb(s) - 'duel_draft_priority' data FROM public.seasons s ORDER BY id")).rows
    const before = await stored()
    await api.db.exec(await readFile(`supabase/migrations/${filename}`, 'utf8'))
    expect(await stored()).toEqual(before)
    expect((await fetchSeasons(leagueId)).find((season) => season.id === seasonId)?.duel_draft_priority).toBeNull()
    expect(await generateLeagueDuelSeasonMatches(seasonId)).toBe(21)
    const fixtures = await fetchMatches(seasonId, leagueId)
    expect(fixtures).toHaveLength(21)
  }, 30000)
})
