/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { fetchMatches, fetchTeamsWithPlayers, recordForfeit, recordResult, setMatchLiveStatus } from './api'
import { clearUnplayedLeagueDuelFixtures, fetchLeagueDuelDraftPreview, generateLeagueDuelSeasonMatches, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
function connect() {
  state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
}
beforeEach(async () => { api = await startLocalSupabase(); connect() }, 20000)
afterEach(async () => { await api?.close() })

async function prepare() {
  const { leagueId, seasonId, players } = api.seeded!
  await setSeasonFormat(seasonId, 'team_duel')
  const preview = await fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map((p) => p.id))
  await saveLeagueDuelDraft(seasonId, preview.drafts[0]!, ['A', 'B'], preview.revision, preview.fingerprint)
  expect(await generateLeagueDuelSeasonMatches(seasonId)).toBe(21)
  return { ...api.seeded!, fixtures: await fetchMatches(seasonId, leagueId), preview }
}

async function preservedRows() {
  const rows: Record<string, unknown> = {}
  for (const table of ['season_roster', 'teams', 'players', 'player_pool', 'league_players', 'rating_history', 'rating_state']) {
    rows[table] = (await api.db.query(`SELECT to_jsonb(t) AS data FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows
  }
  rows.seasons = (await api.db.query("SELECT to_jsonb(t) - ARRAY['duel_draft_rating_revision','duel_draft_rating_fingerprint'] AS data FROM public.seasons t ORDER BY t.id")).rows
  return rows
}

describe('administrator clearing of complete unplayed Team Duel schedules', () => {
  it('preserves all other data, invalidates the draft, and rejects clearing a replacement schedule from a stale page', async () => {
    const setup = await prepare()
    const before = await preservedRows()
    const otherFixtures = (await api.db.query('SELECT * FROM public.matches WHERE season_id <> $1 ORDER BY id', [setup.seasonId])).rows
    const originalTeams = await fetchTeamsWithPlayers(setup.seasonId)
    const oldIds = setup.fixtures.map((match) => match.id)
    expect(await clearUnplayedLeagueDuelFixtures(setup.seasonId, oldIds)).toBe(21)
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toEqual([])
    expect(await preservedRows()).toEqual(before)
    expect(await fetchTeamsWithPlayers(setup.seasonId)).toEqual(originalTeams)
    expect((await api.db.query('SELECT * FROM public.matches WHERE season_id <> $1 ORDER BY id', [setup.seasonId])).rows).toEqual(otherFixtures)
    await expect(generateLeagueDuelSeasonMatches(setup.seasonId)).rejects.toThrow(/DUEL_STALE_DRAFT/)
    const preview = await fetchLeagueDuelDraftPreview(setup.leagueId, setup.seasonId, setup.players.map((p) => p.id))
    await saveLeagueDuelDraft(setup.seasonId, preview.drafts[0]!, ['New A', 'New B'], preview.revision, preview.fingerprint)
    expect(await generateLeagueDuelSeasonMatches(setup.seasonId)).toBe(21)
    const replacement = await fetchMatches(setup.seasonId, setup.leagueId)
    await expect(clearUnplayedLeagueDuelFixtures(setup.seasonId, oldIds)).rejects.toThrow(/DUEL_CLEAR_STALE/)
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toEqual(replacement)
  }, 30000)

  it.each(['result', 'forfeit', 'playing', 'rating-history'] as const)('rejects a schedule with %s and leaves it intact', async (kind) => {
    const setup = await prepare()
    const first = setup.fixtures[0]!
    if (kind === 'result') await recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 7 })
    if (kind === 'forfeit') await recordForfeit(first.id, first.home_team_id, first.home_team_id, first.away_team_id)
    if (kind === 'playing') {
      await api.db.query('UPDATE public.players SET is_present = true WHERE season_id = $1', [setup.seasonId])
      await setMatchLiveStatus(first.id, 'playing')
    }
    if (kind === 'rating-history') {
      await api.db.query(`INSERT INTO public.rating_history(league_id, pool_player_id, match_id, rating, rating_deviation, sequence)
        SELECT league_id, pool_player_id, $1, rating, rating_deviation, 1 FROM public.league_players
        WHERE league_id = $2 AND pool_player_id = $3`, [first.id, setup.leagueId, first.home_pool_player_ids![0]])
    }
    const before = await preservedRows()
    const fixtures = await fetchMatches(setup.seasonId, setup.leagueId)
    await expect(clearUnplayedLeagueDuelFixtures(setup.seasonId, fixtures.map((match) => match.id))).rejects.toThrow(/DUEL_CLEAR_BLOCKED/)
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toEqual(fixtures)
    expect(await preservedRows()).toEqual(before)
  }, 30000)

  it('rejects partial plans, unauthorized callers, inactive seasons and incomplete direct deletions', async () => {
    const setup = await prepare()
    const ids = setup.fixtures.map((match) => match.id)
    await expect(clearUnplayedLeagueDuelFixtures(setup.seasonId, ids.slice(1))).rejects.toThrow(/DUEL_CLEAR_STALE/)
    await expect(clearUnplayedLeagueDuelFixtures(setup.seasonId, [ids[0]!, ...ids.slice(1, -1), ids[0]!])).rejects.toThrow(/DUEL_CLEAR_STALE/)
    await expect(clearUnplayedLeagueDuelFixtures(setup.seasonId, [])).rejects.toThrow(/DUEL_CLEAR_STALE/)
    const anon = createClient(api.url, 'local-anon-key', { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await anon.rpc('clear_unplayed_league_duel_fixtures_atomic', { p_season_id: setup.seasonId, p_expected_match_ids: ids })).error).not.toBeNull()
    await expect(api.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"app_metadata\":{\"role\":\"member\"}}', true)")
      await tx.query('SELECT public.clear_unplayed_league_duel_fixtures_atomic($1,$2)', [setup.seasonId, ids])
    })).rejects.toThrow(/Administrator/)
    await expect(api.db.transaction(async (tx) => {
      await tx.query('DELETE FROM public.matches WHERE id = $1', [ids[0]])
    })).rejects.toThrow(/partnership/)
    // The format guard prevents archival while unplayed games remain. Use an
    // empty archived season and the existing round-robin fixture from the seed.
    const inactive = (await api.db.query<{ id: string }>("INSERT INTO public.seasons(league_id,name,status) VALUES($1,'Archived','archived') RETURNING id", [setup.leagueId])).rows[0]!.id
    await expect(clearUnplayedLeagueDuelFixtures(inactive, ids)).rejects.toThrow(/active Team Duel/)
    const roundRobin = (await api.db.query<{ id: string }>("SELECT id FROM public.seasons WHERE format = 'round_robin' LIMIT 1")).rows[0]!.id
    await expect(clearUnplayedLeagueDuelFixtures(roundRobin, ids)).rejects.toThrow(/active Team Duel/)
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toHaveLength(21)
  }, 30000)

  it('accepts one concurrent clear and rejects the stale duplicate', async () => {
    const setup = await prepare()
    const args = { p_season_id: setup.seasonId, p_expected_match_ids: setup.fixtures.map((match) => match.id) }
    const results = await Promise.all([state.client!.rpc('clear_unplayed_league_duel_fixtures_atomic', args), state.client!.rpc('clear_unplayed_league_duel_fixtures_atomic', args)])
    expect(results.filter((result) => !result.error).map((result) => result.data)).toEqual([21])
    expect(results.find((result) => result.error)?.error?.code).toBe('40001')
    expect(await fetchMatches(setup.seasonId, setup.leagueId)).toEqual([])
  })

  it('clears populated historical mirror fixtures without changing the legacy squads or roster', async () => {
    await api.close()
    api = await startLocalSupabase({ beforeMigration: '20261002170215_league_duel_tier_partnerships.sql' }); connect()
    const { seasonId, leagueId, players } = api.seeded!
    await setSeasonFormat(seasonId, 'team_duel')
    const snapshot = (await state.client!.rpc('league_duel_rating_snapshot', { p_league_id: leagueId })).data!
    expect((await state.client!.rpc('save_league_duel_draft_atomic', {
      p_season_id: seasonId, p_expected_rating_revision: snapshot.revision, p_expected_rating_fingerprint: snapshot.fingerprint,
      p_squads: [players.slice(0, 7), players.slice(7)].map((squad, i) => ({ name: `Legacy ${i}`, color: '#15803d', poolPlayerIds: squad.map((p) => p.id) })),
    })).error).toBeNull()
    expect((await state.client!.rpc('generate_league_duel_matches_atomic', { p_season_id: seasonId })).data).toBe(21)
    await api.db.exec(await readFile('supabase/migrations/20261002170215_league_duel_tier_partnerships.sql', 'utf8'))
    await api.db.exec(await readFile('supabase/migrations/20261002174248_clear_unplayed_league_duel_fixtures.sql', 'utf8'))
    const fixtures = await fetchMatches(seasonId, leagueId)
    const before = await preservedRows()
    expect(await clearUnplayedLeagueDuelFixtures(seasonId, fixtures.map((match) => match.id))).toBe(21)
    expect(await preservedRows()).toEqual(before)
    expect(await fetchMatches(seasonId, leagueId)).toEqual([])
  }, 30000)
})
