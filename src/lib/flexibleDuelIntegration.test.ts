/// <reference types="node" />
import { findDuelSchedule } from './testFixtures/flexibleDuelReference'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
import { readFile } from 'node:fs/promises'
import { measureDuelSchedule, duelScheduleId, type FlexibleDuelPlan } from './flexibleDuel'
import { teamWinProbability } from './ratings'
const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: { from(table: string) { return state.client!.from(table) }, rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) } } }))
import { clearUnplayedLeagueDuelFixtures, fetchFlexibleDuelContext, saveFlexibleDuelPlan, setSeasonFormat, renameLeagueDuelTeam, saveTeamAppearance, fetchLeagueDuelDraftPreview, saveLeagueDuelDraft, generateLeagueDuelSeasonMatches } from './leagueTeamDuelApi'
import { DEFAULT_TEAM_COLORS } from './teamColors'
import { fetchSeasons, fetchTeamsWithPlayers, fetchMatches, recordResult } from './api'
import { saveSeasonRoster } from './seasonRosterApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
beforeEach(async () => {
  api = await startLocalSupabase()
  state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
}, 20000)
afterEach(async () => { await api?.close() })

async function prepare() {
  const seed = api.seeded!
  await setSeasonFormat(seed.seasonId, 'team_duel')
  await saveSeasonRoster(seed.seasonId, seed.players.slice(0, 8).map(p => p.id))
  await api.db.query('UPDATE public.league_players SET rating=1500,rating_deviation=90 WHERE league_id=$1', [seed.leagueId])
  const context = await fetchFlexibleDuelContext(seed.leagueId, seed.seasonId)
  const pool = context.pool.sort((a, b) => a.id.localeCompare(b.id)), squads = [pool.slice(0, 4), pool.slice(4)] as [typeof pool, typeof pool]
  const settings = { maxPartnerMeetings: 2, maxOpponentMeetings: 2 }, games = findDuelSchedule(squads, settings, .500001)!
  const plan: FlexibleDuelPlan = { version: 1, engine: 'cp-sat', inputKey: JSON.stringify([1, context.key, settings]), splitId: 'test-split', settings, squads: squads.map(s => s.map(p => p.id)) as [string[], string[]], option: { id: duelScheduleId(games), kind: 'balance', games, metrics: measureDuelSchedule(squads, games) } }
  return { ...seed, context, plan, squads }
}

describe('flexible plans through PostgreSQL and application APIs', () => {
  it('saves, reloads, generates exactly the selected preview, freezes it, and clears explicitly', async () => {
    const s = await prepare()
    const untouched = (await api.db.query('SELECT to_jsonb(m) data FROM public.matches m WHERE season_id<>$1 ORDER BY id', [s.seasonId])).rows
    const saved = await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, false)
    expect(saved.hash).toHaveLength(32)
    expect(saved.count).toBe(0)
    expect((await fetchTeamsWithPlayers(s.seasonId)).map(team => team.color).sort()).toEqual([...DEFAULT_TEAM_COLORS].sort())
    let season = (await fetchSeasons(s.leagueId)).find(v => v.id === s.seasonId)!
    expect(season.duel_schedule_mode).toBe('flexible')
    expect(season.duel_draft_plan).toEqual(s.plan)
    expect(await generateLeagueDuelSeasonMatches(s.seasonId)).toBe(6)
    const fixtures = await fetchMatches(s.seasonId, s.leagueId)
    expect(fixtures.map(m => ({ roundNumber: m.round_number, sequenceNumber: m.duel_sequence_number, homePoolPlayerIds: m.home_pool_player_ids, awayPoolPlayerIds: m.away_pool_player_ids }))).toEqual(s.plan.option.games)
    const teams = await fetchTeamsWithPlayers(s.seasonId)
    expect(teams.every(t => t.players.every(p => p.duel_tier === null))).toBe(true)
    await renameLeagueDuelTeam(s.seasonId, teams[0]!.id, 'Renamed')
    await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], s.context.revision, s.context.fingerprint, saved.hash, true)).rejects.toThrow('already has matches')
    expect((await state.client!.from('seasons').update({ duel_draft_plan: null }).eq('id', s.seasonId)).error?.message).toContain('frozen')
    const first = fixtures[0]!
    expect((await state.client!.from('matches').update({ home_pool_player_ids: s.plan.squads[0].slice(1, 3) }).eq('id', first.id)).error?.message).toContain('frozen')
    await clearUnplayedLeagueDuelFixtures(s.seasonId, fixtures.map(m => m.id))
    season = (await fetchSeasons(s.leagueId)).find(v => v.id === s.seasonId)!
    expect(season.duel_draft_plan).toBeNull(); expect(season.duel_draft_plan_hash).toBeNull()
    expect((await api.db.query('SELECT to_jsonb(m) data FROM public.matches m WHERE season_id<>$1 ORDER BY id', [s.seasonId])).rows).toEqual(untouched)
  }, 30000)
  it('persists custom colors through draft reload, generation and later appearance edits', async () => {
    const s = await prepare()
    await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, false, ['#9333ea', '#0891b2'])
    let teams = await fetchTeamsWithPlayers(s.seasonId)
    expect(teams.map(team => team.color).sort()).toEqual(['#0891b2', '#9333ea'])
    const first = teams.find(team => team.name === 'A')!
    await saveTeamAppearance(s.seasonId, first.id, first.name, '#be123c')
    await generateLeagueDuelSeasonMatches(s.seasonId)
    teams = await fetchTeamsWithPlayers(s.seasonId)
    expect(teams.find(team => team.name === 'A')?.color).toBe('#be123c')
    const fixtures = await fetchMatches(s.seasonId, s.leagueId)
    expect(fixtures.every(match => match.home_team.color === '#be123c' && match.away_team.color === '#0891b2')).toBe(true)
    const snapshot = await api.db.query('SELECT id,home_team_id,away_team_id,home_pool_player_ids,away_pool_player_ids,status FROM public.matches WHERE season_id=$1 ORDER BY id', [s.seasonId])
    await saveTeamAppearance(s.seasonId, teams.find(team => team.name === 'A')!.id, 'A', '#2563eb')
    expect((await api.db.query('SELECT id,home_team_id,away_team_id,home_pool_player_ids,away_pool_player_ids,status FROM public.matches WHERE season_id=$1 ORDER BY id', [s.seasonId])).rows).toEqual(snapshot.rows)
    expect((await fetchMatches(s.seasonId, s.leagueId))[0]!.home_team.color).toBe('#2563eb')
  }, 30000)

  it('rejects malformed colors atomically and keeps appearance edits restricted to administrators', async () => {
    const s = await prepare()
    const args = { p_season_id: s.seasonId, p_plan: s.plan, p_names: ['A', 'B'], p_expected_rating_revision: s.context.revision, p_expected_rating_fingerprint: s.context.fingerprint, p_expected_plan_hash: null }
    expect((await state.client!.rpc('save_league_duel_plan_atomic', { ...args, p_colors: ['red', '#2563eb'] })).error?.message).toContain('valid team colors')
    expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
    await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, true, ['#9333ea', '#0891b2'])
    const team = (await fetchTeamsWithPlayers(s.seasonId))[0]!
    await expect(saveTeamAppearance(s.seasonId, team.id, team.name, 'red')).rejects.toThrow('valid team color')
    const player = await api.addAccount({ email: 'colors@example.test' })
    const member = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${player.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    expect((await member.from('teams').update({ color: '#000000' }).eq('id', team.id).select('id').single()).error).not.toBeNull()
    expect((await fetchTeamsWithPlayers(s.seasonId)).find(saved => saved.id === team.id)?.color).toBe(team.color)
  }, 30000)
  it('rejects stale snapshots and stale saved-plan hashes without partial changes', async () => {
    const s = await prepare()
    await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], -1, s.context.fingerprint, null, true)).rejects.toThrow('Ratings changed')
    expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
    const saved = await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, false)
    await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['Wrong', 'Wrong'], s.context.revision, s.context.fingerprint, null, true)).rejects.toThrow('Saved draft changed')
    expect((await fetchTeamsWithPlayers(s.seasonId)).map(t => t.name).sort()).toEqual(['A', 'B'])
    expect((await fetchSeasons(s.leagueId)).find(v => v.id === s.seasonId)?.duel_draft_plan_hash).toBe(saved.hash)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(0)
    await api.db.query('UPDATE public.league_players SET rating=rating+1 WHERE league_id=$1', [s.leagueId])
    await expect(generateLeagueDuelSeasonMatches(s.seasonId)).rejects.toThrow('DUEL_STALE_DRAFT')
  })
  it('does not trust client metrics, caps, fixture membership or rounds', async () => {
    const s = await prepare()
    const invalid: FlexibleDuelPlan[] = []
    const repeats = structuredClone(s.plan)
    repeats.option.games = Array.from({ length: 3 }, (_, r) => s.plan.option.games.slice(0, 2).map((g, i) => ({ ...g, roundNumber: r + 1, sequenceNumber: r * 2 + i + 1 }))).flat()
    invalid.push(repeats)
    const duplicate = structuredClone(s.plan); duplicate.option.games[0]!.homePoolPlayerIds[1] = duplicate.option.games[0]!.homePoolPlayerIds[0]; invalid.push(duplicate)
    const wrongRound = structuredClone(s.plan); wrongRound.option.games[0]!.roundNumber = 99; invalid.push(wrongRound)
    const cap = structuredClone(s.plan); cap.settings.maxOpponentMeetings = 1; invalid.push(cap)
    for (const plan of invalid) await expect(saveFlexibleDuelPlan(s.seasonId, plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, true)).rejects.toThrow()
    expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(0)
    await api.db.query('UPDATE public.league_players SET rating=CASE WHEN pool_player_id=ANY($2::uuid[]) THEN 2000 ELSE 1000 END WHERE league_id=$1', [s.leagueId, s.plan.squads[0]])
    s.plan.settings.maxMatchProbability = 1 // Isolate the season guard from the per-match guard.
    const fresh = await fetchFlexibleDuelContext(s.leagueId, s.seasonId)
    await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, null, true)).rejects.toThrow('DUEL_SEASON_BALANCE')
    expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
  })
  it('enforces the chosen match ceiling in PostgreSQL without trusting client metrics', async () => {
    const s = await prepare()
    for (const side of s.plan.squads) for (const [i, id] of side.entries()) {
      await api.db.query('UPDATE public.league_players SET rating=$1 WHERE league_id=$2 AND pool_player_id=$3', [2100 - i * 400, s.leagueId, id])
    }
    const fresh = await fetchFlexibleDuelContext(s.leagueId, s.seasonId)
    s.plan.settings.maxPartnerMeetings = 3
    s.plan.settings.maxOpponentMeetings = 3
    // Equal squad totals, with deliberately mismatched doubles and forged metrics.
    for (const g of s.plan.option.games) {
      const indices = g.homePoolPlayerIds.map(id => s.plan.squads[0].indexOf(id))
      g.awayPoolPlayerIds = indices.map(i => s.plan.squads[1][3-i]!) as [string, string]
    }
    s.plan.option.metrics.worstFavorite = .5
    for (const limit of [undefined, .6, .65, .7]) {
      s.plan.settings.maxMatchProbability = limit
      await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, null, true)).rejects.toThrow('DUEL_MATCH_BALANCE')
      expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
      expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(0)
    }
    for (const limit of [.49, 1.01]) {
      s.plan.settings.maxMatchProbability = limit
      await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, null, true)).rejects.toThrow('DUEL_MATCH_LIMIT_RANGE')
    }
    s.plan.settings.maxMatchProbability = 1
    const saved = await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, null, true)
    expect(saved.count).toBe(6)
    expect((await fetchSeasons(s.leagueId)).find(season => season.id === s.seasonId)!.duel_draft_plan!.settings.maxMatchProbability).toBe(1)
  }, 30000)
  it('requires a fresh search for legacy engines and removed schedule objectives', async () => {
    const s = await prepare()
    for (const [engine, kind] of [[undefined, 'balance'], ['exhaustive', 'balance'], ['cp-sat', 'experience'], ['cp-sat', 'alternative']] as const) {
      const plan = structuredClone(s.plan); plan.engine = engine; plan.option.kind = kind
      await expect(saveFlexibleDuelPlan(s.seasonId, plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, true)).rejects.toThrow('DUEL_STALE_DRAFT')
      const response = await state.client!.rpc('save_and_generate_league_duel_plan_atomic', { p_season_id: s.seasonId, p_plan: plan, p_names: ['A', 'B'], p_expected_rating_revision: s.context.revision, p_expected_rating_fingerprint: s.context.fingerprint, p_expected_plan_hash: null })
      expect(response.error?.message).toContain('DUEL_STALE_DRAFT')
    }
    expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(0)
  })
  it('enforces the four-player spread on save and generation and persists the cap', async () => {
    const s = await prepare()
    s.plan.engine = 'cp-sat'
    s.plan.settings = { ...s.plan.settings, maxPartnerMeetings: 3, maxOpponentMeetings: 3, maxRatingDifference: 400 }
    for (const side of s.plan.squads) for (const [i, id] of side.entries()) {
      await api.db.query('UPDATE public.league_players SET rating=$1 WHERE league_id=$2 AND pool_player_id=$3', [i < 2 ? 1900.25 : 1500.25, s.leagueId, id])
    }
    // Match identical ranks across squads: every match and the season are balanced.
    for (const game of s.plan.option.games) game.awayPoolPlayerIds = game.homePoolPlayerIds.map(id => s.plan.squads[1][s.plan.squads[0].indexOf(id)]!) as [string, string]
    let fresh = await fetchFlexibleDuelContext(s.leagueId, s.seasonId)
    for (const limit of [-1, .5, '400', true]) {
      const plan = structuredClone(s.plan); plan.settings.maxRatingDifference = limit as number
      const response = await state.client!.rpc('save_and_generate_league_duel_plan_atomic', { p_season_id: s.seasonId, p_plan: plan, p_names: ['A', 'B'], p_expected_rating_revision: fresh.revision, p_expected_rating_fingerprint: fresh.fingerprint, p_expected_plan_hash: null })
      expect(response.error?.message).toContain('DUEL_RATING_LIMIT_RANGE')
    }
    s.plan.settings.maxRatingDifference = 399
    for (const generate of [false, true]) await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, null, generate)).rejects.toThrow('DUEL_RATING_DIFFERENCE')
    expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(0)
    s.plan.settings.maxRatingDifference = 400
    const saved = await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, null, false)
    expect((await fetchSeasons(s.leagueId)).find(season => season.id === s.seasonId)!.duel_draft_plan!.settings.maxRatingDifference).toBe(400)
    // A fractional change above the cap is rejected, even with forged client metrics.
    await api.db.query('UPDATE public.league_players SET rating=1900.26 WHERE league_id=$1 AND pool_player_id=ANY($2::uuid[])', [s.leagueId, [s.plan.squads[0][0], s.plan.squads[1][0]]])
    fresh = await fetchFlexibleDuelContext(s.leagueId, s.seasonId)
    await expect(saveFlexibleDuelPlan(s.seasonId, s.plan, ['Changed', 'Changed'], fresh.revision, fresh.fingerprint, saved.hash, true)).rejects.toThrow('DUEL_RATING_DIFFERENCE')
    expect((await fetchTeamsWithPlayers(s.seasonId)).map(t => t.name).sort()).toEqual(['A', 'B'])
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(0)
    expect((await fetchSeasons(s.leagueId)).find(season => season.id === s.seasonId)!.duel_draft_plan_hash).toBe(saved.hash)
    s.plan.settings.maxRatingDifference = null
    expect((await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, saved.hash, true)).count).toBe(6)
  }, 30000)
  it('allows a zero point cap for equal unrounded ratings', async () => {
    const s = await prepare(); s.plan.settings.maxRatingDifference = 0
    await api.db.query('UPDATE public.league_players SET rating=1500.25 WHERE league_id=$1', [s.leagueId])
    const fresh = await fetchFlexibleDuelContext(s.leagueId, s.seasonId)
    expect((await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], fresh.revision, fresh.fingerprint, null, true)).count).toBe(6)
  })
  it('rejects duplicate four-player games in raw RPCs and the database index', async () => {
    const s = await prepare()
    const repeated = structuredClone(s.plan)
    repeated.settings.maxPartnerMeetings = 3; repeated.settings.maxOpponentMeetings = 3
    repeated.option.games = Array.from({ length: 3 }, (_, r) => s.plan.option.games.slice(0, 2).map((g, i) => ({ ...g, roundNumber: r + 1, sequenceNumber: r * 2 + i + 1 }))).flat()
    await expect(saveFlexibleDuelPlan(s.seasonId, repeated, ['A', 'B'], s.context.revision, s.context.fingerprint, null, true)).rejects.toThrow('DUEL_DUPLICATE_MATCH')
    const response = await state.client!.rpc('save_and_generate_league_duel_plan_atomic', { p_season_id: s.seasonId, p_plan: repeated, p_names: ['A', 'B'], p_expected_rating_revision: s.context.revision, p_expected_rating_fingerprint: s.context.fingerprint, p_expected_plan_hash: null })
    expect(response.error?.message).toContain('DUEL_DUPLICATE_MATCH')
    expect(await fetchTeamsWithPlayers(s.seasonId)).toHaveLength(0)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(0)
    await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, true)
    const matches = await fetchMatches(s.seasonId, s.leagueId)
    // Isolate the unique index from application triggers in the disposable database.
    await api.db.exec('ALTER TABLE public.matches DISABLE TRIGGER USER')
    try {
      await expect(api.db.query(`INSERT INTO public.matches(season_id,home_team_id,away_team_id,round_number,duel_sequence_number,home_pool_player_ids,away_pool_player_ids,status)
        SELECT season_id,away_team_id,home_team_id,round_number+100,duel_sequence_number+100,away_pool_player_ids,home_pool_player_ids,'scheduled'
        FROM public.matches WHERE id=$1`, [matches[0]!.id])).rejects.toThrow('matches_unique_four_players_per_season')
      await expect(api.db.query(`INSERT INTO public.matches(season_id,home_team_id,away_team_id,round_number,duel_sequence_number,home_pool_player_ids,away_pool_player_ids,status)
        SELECT season_id,home_team_id,away_team_id,round_number+100,duel_sequence_number+100,
        ARRAY[home_pool_player_ids[1],away_pool_player_ids[1]],ARRAY[home_pool_player_ids[2],away_pool_player_ids[2]],'scheduled'
        FROM public.matches WHERE id=$1`, [matches[0]!.id])).rejects.toThrow('matches_unique_four_players_per_season')
    } finally { await api.db.exec('ALTER TABLE public.matches ENABLE TRIGGER USER') }
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(6)
  }, 30000)
  it('rechecks caps when an authenticated administrator bypasses the UI', async () => {
    const s = await prepare()
    const saved = await saveFlexibleDuelPlan(s.seasonId, s.plan, ['A', 'B'], s.context.revision, s.context.fingerprint, null, false)
    const modified = structuredClone(s.plan); modified.settings.maxPartnerMeetings = 0
    expect((await state.client!.from('seasons').update({ duel_draft_plan: modified }).eq('id', s.seasonId)).error).not.toBeNull()
    expect((await fetchSeasons(s.leagueId)).find(v => v.id === s.seasonId)?.duel_draft_plan_hash).toBe(saved.hash)
    const anon = createClient(api.url, 'local-anon-key', { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await anon.rpc('save_league_duel_plan_atomic', { p_season_id: s.seasonId, p_plan: s.plan, p_names: ['A', 'B'], p_expected_rating_revision: s.context.revision, p_expected_rating_fingerprint: s.context.fingerprint, p_expected_plan_hash: saved.hash })).error).not.toBeNull()
  })
  it('matches the application probability formula including rating uncertainty', async () => {
    for (const [delta, rd] of [[0, 90], [400, 90], [-900, 160], [10, 300]]) {
      const skill = (rating: number) => ({ rating, rd: rd!, volatility: 0 })
      const expected = teamWinProbability([skill(1500 + delta!), skill(1500)], [skill(1500), skill(1500)])!
      const result = await api.db.query('SELECT public.duel_standard_normal_cdf($1/sqrt(250000.0+4*$2*$2)) AS p', [delta, rd])
      expect((result.rows[0] as { p: number }).p).toBeCloseTo(expected, 12)
    }
  })
  it('generates odd-sized squads with byes and preserves the plan across result corrections', async () => {
    const seed = api.seeded!
    await setSeasonFormat(seed.seasonId, 'team_duel')
    await saveSeasonRoster(seed.seasonId, seed.players.slice(0, 10).map(p => p.id))
    await api.db.query('UPDATE public.league_players SET rating=1500,rating_deviation=90 WHERE league_id=$1', [seed.leagueId])
    const context = await fetchFlexibleDuelContext(seed.leagueId, seed.seasonId)
    const pool = context.pool.sort((a, b) => a.id.localeCompare(b.id)), squads = [pool.slice(0, 5), pool.slice(5)] as [typeof pool, typeof pool]
    const settings = { maxPartnerMeetings: 1, maxOpponentMeetings: null }
    const games = findDuelSchedule(squads, settings, .500001)!
    const plan: FlexibleDuelPlan = { version: 1, engine: 'cp-sat', inputKey: context.key, splitId: 'odd', settings, squads: squads.map(s => s.map(p => p.id)) as [string[], string[]], option: { id: duelScheduleId(games), kind: 'balance', games, metrics: measureDuelSchedule(squads, games) } }
    const saved = await saveFlexibleDuelPlan(seed.seasonId, plan, ['A', 'B'], context.revision, context.fingerprint, null, true)
    expect(saved.count).toBe(10)
    const first = (await fetchMatches(seed.seasonId, seed.leagueId))[0]!
    await recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 5 })
    await recordResult(first.id, { winnerTeamId: first.away_team_id, homeScore: 7, awayScore: 11 })
    expect((await fetchSeasons(seed.leagueId)).find(s => s.id === seed.seasonId)?.duel_draft_plan).toEqual(plan)
    expect((await fetchMatches(seed.seasonId, seed.leagueId)).find(m => m.id === first.id)?.winner_team_id).toBe(first.away_team_id)
    await expect(clearUnplayedLeagueDuelFixtures(seed.seasonId, (await fetchMatches(seed.seasonId, seed.leagueId)).map(m => m.id))).rejects.toThrow()
  }, 30000)
  it('preserves generated legacy plans and result corrections across the point-cap migration', async () => {
    await api.close()
    const filename = '20261108173913_duel_ranking_point_limit.sql'
    api = await startLocalSupabase({ beforeMigration: filename })
    state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const s = await prepare(); s.plan.engine = 'exhaustive'; s.plan.option.kind = 'experience'
    // Simulate a plan generated by the previous app before this migration existed.
    const created = await state.client!.rpc('save_and_generate_league_duel_plan_atomic', { p_season_id: s.seasonId, p_plan: s.plan, p_names: ['A', 'B'], p_expected_rating_revision: s.context.revision, p_expected_rating_fingerprint: s.context.fingerprint, p_expected_plan_hash: null })
    expect(created.error).toBeNull()
    const before = await api.db.query('SELECT to_jsonb(m) data FROM public.matches m WHERE season_id=$1 ORDER BY id', [s.seasonId])
    await api.db.exec(await readFile(`supabase/migrations/${filename}`, 'utf8'))
    expect((await api.db.query('SELECT to_jsonb(m) data FROM public.matches m WHERE season_id=$1 ORDER BY id', [s.seasonId])).rows).toEqual(before.rows)
    expect((await fetchSeasons(s.leagueId)).find(season => season.id === s.seasonId)!.duel_draft_plan).toEqual(s.plan)
    const first = (await fetchMatches(s.seasonId, s.leagueId))[0]!
    await recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 5 })
    await recordResult(first.id, { winnerTeamId: first.away_team_id, homeScore: 7, awayScore: 11 })
    expect((await fetchSeasons(s.leagueId)).find(season => season.id === s.seasonId)!.duel_draft_plan).toEqual(s.plan)
    expect((await fetchMatches(s.seasonId, s.leagueId)).find(match => match.id === first.id)!.winner_team_id).toBe(first.away_team_id)
  }, 30000)
  it('preserves populated legacy fixtures during migration', async () => {
    await api.close()
    const filename = '20261103060704_flexible_league_duel_plans.sql'
    api = await startLocalSupabase({ beforeMigration: filename })
    state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const seed = api.seeded!
    await setSeasonFormat(seed.seasonId, 'team_duel'); await saveSeasonRoster(seed.seasonId, seed.players.slice(0, 8).map(p => p.id))
    const preview = await fetchLeagueDuelDraftPreview(seed.leagueId, seed.seasonId, [])
    const draft = preview.drafts[0]!
    await saveLeagueDuelDraft(seed.seasonId, draft, ['Legacy A', 'Legacy B'], preview.revision, preview.fingerprint)
    await generateLeagueDuelSeasonMatches(seed.seasonId)
    const before = (await api.db.query('SELECT to_jsonb(m) data FROM public.matches m ORDER BY id')).rows
    await api.db.exec(await readFile(`supabase/migrations/${filename}`, 'utf8'))
    expect((await api.db.query('SELECT to_jsonb(m) data FROM public.matches m ORDER BY id')).rows).toEqual(before)
    await api.db.query('SELECT public.validate_league_duel_season($1)', [seed.seasonId])
  }, 30000)
})
