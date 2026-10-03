/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { fetchMatches, fetchTeamsWithPlayers, recordResult } from './api'
import { fetchLeagueDuelDraftPreview, generateLeagueDuelSeasonMatches, renameLeagueDuelTeam, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { partnershipKey } from './balanceTeams'
import { season13RatingSnapshot } from './testFixtures/season13RatingSnapshot'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
beforeEach(async () => {
  api = await startLocalSupabase()
  state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
}, 20000)
afterEach(async () => { await api?.close() })

async function prepare() {
  const { leagueId, seasonId, players } = api.seeded!
  await setSeasonFormat(seasonId, 'team_duel')
  const preview = await fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map((p) => p.id))
  const draft = preview.drafts[0]!
  await saveLeagueDuelDraft(seasonId, draft, ['A', 'B'], preview.revision, preview.fingerprint)
  const teams = await fetchTeamsWithPlayers(seasonId)
  const home = teams.find((team) => team.players.some((player) => player.pool_player_id === draft.squads[0][0]!.id))!
  const away = teams.find((team) => team.id !== home.id)!
  const matches = draft.schedule.games.map((game) => ({ ...game, homeTeamId: home.id, awayTeamId: away.id }))
  return { ...api.seeded!, preview, draft, teams, matches, args: {
    p_season_id: seasonId, p_matches: matches,
    p_expected_rating_revision: preview.revision, p_expected_rating_fingerprint: preview.fingerprint,
  } }
}

async function fixtureCount(seasonId: string) {
  return (await api.db.query<{ count: number }>('SELECT count(*)::integer AS count FROM public.matches WHERE season_id = $1', [seasonId])).rows[0]!.count
}

describe('fresh tier generation through PostgreSQL and the application API', () => {
  it('renames squads before and after recorded games without altering frozen data, and requires admin access', async () => {
    const setup = await prepare()
    const [home, away] = setup.teams
    await renameLeagueDuelTeam(setup.seasonId, home!.id, '  New draft name  ')
    expect((await fetchTeamsWithPlayers(setup.seasonId)).find((team) => team.id === home!.id)?.name).toBe('New draft name')
    await generateLeagueDuelSeasonMatches(setup.seasonId)
    const first = (await fetchMatches(setup.seasonId, setup.leagueId))[0]!
    await recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 7 })
    const unchangedTables = ['seasons', 'season_roster', 'players', 'matches', 'league_players', 'rating_history', 'rating_state']
    const snapshot = async () => Promise.all(unchangedTables.map(async (table) =>
      (await api.db.query(`SELECT to_jsonb(row) AS data FROM public.${table} AS row ORDER BY to_jsonb(row)::text`)).rows))
    const original = await snapshot()
    const teams = (await api.db.query('SELECT to_jsonb(team) - \'name\' AS data FROM public.teams AS team ORDER BY id')).rows

    await renameLeagueDuelTeam(setup.seasonId, home!.id, '  Green Dragons  ')
    await renameLeagueDuelTeam(setup.seasonId, away!.id, 'Blue Tigers')
    expect(await snapshot()).toEqual(original)
    expect((await api.db.query('SELECT to_jsonb(team) - \'name\' AS data FROM public.teams AS team ORDER BY id')).rows).toEqual(teams)
    const names = new Map([[home!.id, 'Green Dragons'], [away!.id, 'Blue Tigers']])
    const matches = await fetchMatches(setup.seasonId, setup.leagueId)
    for (const match of matches) {
      expect(match.home_team.name).toBe(names.get(match.home_team_id))
      expect(match.away_team.name).toBe(names.get(match.away_team_id))
      if (match.winner) expect(match.winner.name).toBe(names.get(match.winner_team_id!))
    }
    await expect(renameLeagueDuelTeam(setup.seasonId, home!.id, '   ')).rejects.toThrow(/1 and 120/)
    await expect(renameLeagueDuelTeam(setup.seasonId, home!.id, 'x'.repeat(121))).rejects.toThrow(/1 and 120/)
    await expect(renameLeagueDuelTeam(randomUUID(), home!.id, 'Wrong season')).rejects.toThrow()
    const admin = state.client
    state.client = createClient(api.url, 'local-anon-key', { auth: { persistSession: false, autoRefreshToken: false } })
    try { await expect(renameLeagueDuelTeam(setup.seasonId, home!.id, 'Visitor edit')).rejects.toThrow() }
    finally { state.client = admin }
    expect((await fetchTeamsWithPlayers(setup.seasonId)).find((team) => team.id === home!.id)?.name).toBe('Green Dragons')
    expect(await snapshot()).toEqual(original)
  }, 30000)

  it('generates the Season 13 rating snapshot atomically with one winner in a generation race', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    await setSeasonFormat(seasonId, 'team_duel')
    for (const [index, player] of players.entries()) {
      const snapshot = season13RatingSnapshot[index]!
      await api.db.query('UPDATE public.league_players SET rating = $1, rating_deviation = $2 WHERE league_id = $3 AND pool_player_id = $4', [snapshot.rating, snapshot.rd, leagueId, player.id])
    }
    const initialSeason = (await api.db.query('SELECT to_jsonb(s) - ARRAY[\'duel_schedule_mode\', \'duel_draft_rating_revision\', \'duel_draft_rating_fingerprint\'] AS data FROM public.seasons s WHERE id = $1', [seasonId])).rows
    const roster = (await api.db.query('SELECT * FROM public.season_roster WHERE season_id = $1 ORDER BY pool_player_id', [seasonId])).rows
    const ratings = (await api.db.query('SELECT * FROM public.league_players ORDER BY league_id, pool_player_id')).rows
    const history = (await api.db.query('SELECT * FROM public.rating_history ORDER BY id')).rows
    const setup = await prepare()
    const results = await Promise.all([
      state.client!.rpc('generate_league_duel_matches_atomic', setup.args),
      state.client!.rpc('generate_league_duel_matches_atomic', setup.args),
    ])
    expect(results.filter((r) => !r.error).map((r) => r.data)).toEqual([21])
    expect(results.find((r) => r.error)?.error?.message).toContain('already has matches')
    expect(await fixtureCount(seasonId)).toBe(21)
    const fixtures = await fetchMatches(seasonId, leagueId)
    const tiers = new Map(setup.teams.flatMap((team) => team.players.map((player) => [player.pool_player_id, player.duel_tier])))
    for (const team of setup.teams) expect(['top', 'middle', 'bottom'].map((tier) => team.players.filter((p) => p.duel_tier === tier).length)).toEqual([2, 3, 2])
    for (const player of players) {
      const appearances = fixtures.filter((game) => [...game.home_pool_player_ids!, ...game.away_pool_player_ids!].includes(player.id))
      expect(appearances).toHaveLength(6)
      const partners = appearances.map((game) => (game.home_pool_player_ids!.includes(player.id) ? game.home_pool_player_ids! : game.away_pool_player_ids!).find((id) => id !== player.id))
      expect(new Set(partners).size).toBe(6)
      expect(new Set(appearances.map((game) => game.round_number)).size).toBe(6)
    }
    for (const game of fixtures) expect(game.home_pool_player_ids!.map((id) => tiers.get(id)).sort()).toEqual(game.away_pool_player_ids!.map((id) => tiers.get(id)).sort())
    for (let round = 1; round <= 7; round++) {
      const games = fixtures.filter((game) => game.round_number === round)
      expect(games).toHaveLength(3)
      expect(new Set(games.flatMap((game) => [...game.home_pool_player_ids!, ...game.away_pool_player_ids!])).size).toBe(12)
    }
    expect((await api.db.query('SELECT to_jsonb(s) - ARRAY[\'duel_schedule_mode\', \'duel_draft_rating_revision\', \'duel_draft_rating_fingerprint\'] AS data FROM public.seasons s WHERE id = $1', [seasonId])).rows).toEqual(initialSeason)
    expect((await api.db.query('SELECT * FROM public.season_roster WHERE season_id = $1 ORDER BY pool_player_id', [seasonId])).rows).toEqual(roster)
    expect((await api.db.query('SELECT * FROM public.league_players ORDER BY league_id, pool_player_id')).rows).toEqual(ratings)
    expect((await api.db.query('SELECT * FROM public.rating_history ORDER BY id')).rows).toEqual(history)
    await expect(generateLeagueDuelSeasonMatches(seasonId)).rejects.toThrow(/already has matches/)
    const firstPlayer = setup.teams[0]!.players[0]!
    expect((await state.client!.from('players').update({ duel_tier: firstPlayer.duel_tier === 'top' ? 'bottom' : 'top' }).eq('id', firstPlayer.id)).error?.message).toContain('frozen')
    expect((await state.client!.from('seasons').update({ duel_schedule_mode: null }).eq('id', seasonId)).error?.message).toContain('frozen')
  }, 30000)

  it('rejects malformed plans, stale snapshots and changed squads without partial fixtures', async () => {
    const setup = await prepare()
    const tier = new Map(setup.teams.flatMap((team) => team.players.map((player) => [player.pool_player_id, player.duel_tier])))
    const combo = (ids: string[]) => ids.map((id) => tier.get(id)).sort().join(':')
    const mismatch = setup.matches.find((game) => combo(game.awayPoolPlayerIds) !== combo(setup.matches[0]!.homePoolPlayerIds))!
    const sameCombo = setup.matches.find((game, i) => i > 0 && combo(game.awayPoolPlayerIds) === combo(setup.matches[0]!.awayPoolPlayerIds))!
    // Swap complete compatible partnerships across rounds, retaining pair coverage
    // and tier matching while introducing a repeated participant within a round.
    const conflict = setup.matches.flatMap((first, i) => setup.matches.slice(i + 1).flatMap((second) => {
      if (first.roundNumber === second.roundNumber || combo(first.awayPoolPlayerIds) !== combo(second.awayPoolPlayerIds)) return []
      const others = setup.matches.filter((game) => game.roundNumber === first.roundNumber && game !== first)
      if (!others.some((game) => game.awayPoolPlayerIds.some((id) => second.awayPoolPlayerIds.includes(id)))) return []
      return [setup.matches.map((game) => game === first ? { ...game, awayPoolPlayerIds: second.awayPoolPlayerIds }
        : game === second ? { ...game, awayPoolPlayerIds: first.awayPoolPlayerIds } : game)]
    }))[0]!
    expect(conflict).toBeDefined()
    const malformed = [
      setup.matches.slice(1),
      setup.matches.map((game, i) => i === 0 ? { ...game, awayPoolPlayerIds: mismatch.awayPoolPlayerIds } : game),
      setup.matches.map((game, i) => i === 0 ? { ...game, awayPoolPlayerIds: sameCombo.awayPoolPlayerIds } : game),
      setup.matches.map((game, i) => i === 0 ? { ...game, homePoolPlayerIds: [game.homePoolPlayerIds[0], game.homePoolPlayerIds[0]] } : game),
      setup.matches.map((game, i) => i === 0 ? { ...game, sequenceNumber: 2 } : game),
      setup.matches.map((game, i) => i === 0 ? { ...game, roundNumber: 0 } : game),
      conflict,
    ]
    for (const matches of malformed) {
      const result = await state.client!.rpc('generate_league_duel_matches_atomic', { ...setup.args, p_matches: matches })
      expect(result.error).not.toBeNull()
      expect(await fixtureCount(setup.seasonId)).toBe(0)
    }
    expect((await state.client!.rpc('generate_league_duel_matches_atomic', { ...setup.args, p_expected_rating_fingerprint: 'stale' })).error?.code).toBe('40001')
    await saveLeagueDuelDraft(setup.seasonId, setup.preview.drafts[1]!, ['Changed A', 'Changed B'], setup.preview.revision, setup.preview.fingerprint)
    expect((await state.client!.rpc('generate_league_duel_matches_atomic', setup.args)).error?.code).toBe('40001')
    expect(await fixtureCount(setup.seasonId)).toBe(0)
    await api.db.query('UPDATE public.rating_state SET revision = revision + 1 WHERE league_id = $1', [setup.leagueId])
    await expect(generateLeagueDuelSeasonMatches(setup.seasonId)).rejects.toThrow(/DUEL_STALE_DRAFT/)
    expect(await fixtureCount(setup.seasonId)).toBe(0)
  })

  it('rejects unequal global tiers before replacing a saved draft', async () => {
    const setup = await prepare()
    const original = await fetchTeamsWithPlayers(setup.seasonId)
    const result = await state.client!.rpc('save_league_duel_draft_atomic', {
      p_season_id: setup.seasonId,
      p_expected_rating_revision: setup.preview.revision,
      p_expected_rating_fingerprint: setup.preview.fingerprint,
      p_squads: [setup.players.slice(0, 7), setup.players.slice(7)].map((players, i) => ({
        name: `Invalid ${i}`, color: '#15803d', poolPlayerIds: players.map((player) => player.id),
      })),
    })
    expect(result.error?.message).toContain('equal top, middle, and bottom tier composition')
    expect(await fetchTeamsWithPlayers(setup.seasonId)).toEqual(original)
    expect(await fixtureCount(setup.seasonId)).toBe(0)
  })

  it('fails the preview when partnership history cannot be loaded', async () => {
    await api.db.exec('REVOKE EXECUTE ON FUNCTION public.league_duel_partner_history(uuid) FROM authenticated')
    const { leagueId, seasonId, players } = api.seeded!
    await expect(fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map((p) => p.id))).rejects.toThrow(/permission denied/)
  })

  it('uses snapshots and legacy round-robin lineups once per season within the exact three-season window', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    const ids = players.map((p) => p.id)
    await api.db.query("UPDATE public.seasons SET starts_at = '2026-10-02' WHERE id = $1", [seasonId])
    async function historicalRoundRobin(date: string, pair: [string, string], status = 'completed', legacy = false) {
      const season = randomUUID(), home = randomUUID(), away = randomUUID(), match = randomUUID()
      await api.db.transaction(async (tx) => {
        await tx.query("INSERT INTO public.seasons(id, league_id, name, status, starts_at) VALUES ($1,$2,'Previous','archived',$3)", [season, leagueId, date])
        for (const [team, roster] of [[home, pair], [away, [ids[12]!, ids[13]!]]] as const) {
          await tx.query("INSERT INTO public.teams(id, season_id, name, color) VALUES($1,$2,'Previous','#15803d')", [team, season])
          for (const player of roster) await tx.query('INSERT INTO public.players(season_id, team_id, pool_player_id, name) VALUES($1,$2,$3::uuid,($3::uuid)::text)', [season, team, player])
        }
        await tx.query(`INSERT INTO public.matches(id, season_id, home_team_id, away_team_id, round_number, status, winner_team_id, home_score, away_score, home_pool_player_ids, away_pool_player_ids)
          VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)`, [match, season, home, away, status, status === 'scheduled' ? null : home, status === 'completed' ? 11 : null, status === 'completed' ? 7 : null, legacy ? null : pair, legacy ? null : [ids[12], ids[13]]])
      })
      return { season, home, away, match }
    }
    const oldest = await historicalRoundRobin('2026-09-01', [ids[0]!, ids[6]!])
    const third = await historicalRoundRobin('2026-09-28', [ids[0]!, ids[3]!], 'forfeit')
    const second = await historicalRoundRobin('2026-09-29', [ids[0]!, ids[1]!], 'completed', true)
    const latest = await historicalRoundRobin('2026-09-30', [ids[0]!, ids[1]!])
    await historicalRoundRobin('2026-10-03', [ids[0]!, ids[7]!])
    const foreignLeague = randomUUID()
    await api.db.query("INSERT INTO public.leagues(id, slug, name) VALUES ($1,$2,'Other league')", [foreignLeague, `other-${foreignLeague}`])
    await api.db.query("INSERT INTO public.seasons(league_id, name, status, starts_at) VALUES($1,'Foreign season','archived','2026-10-01')", [foreignLeague])
    await api.db.transaction(async (tx) => {
      const thirdTeam = randomUUID()
      await tx.query("INSERT INTO public.teams(id, season_id, name, color) VALUES($1,$2,'Another opponent','#15803d')", [thirdTeam, latest.season])
      for (const id of [ids[8], ids[9]]) await tx.query('INSERT INTO public.players(season_id, team_id, pool_player_id, name) VALUES($1,$2,$3::uuid,($3::uuid)::text)', [latest.season, thirdTeam, id])
      await tx.query(`INSERT INTO public.matches(season_id, home_team_id, away_team_id, round_number, status, winner_team_id, home_score, away_score, home_pool_player_ids, away_pool_player_ids)
        VALUES($1,$2,$3,2,'completed',$2,11,7,$4,$5)`, [latest.season, latest.home, thirdTeam, [ids[0], ids[1]], [ids[8], ids[9]]])
    })
    // Current membership changes must not replace an existing match snapshot.
    await api.db.query('UPDATE public.players SET pool_player_id = $1 WHERE team_id = $2 AND pool_player_id = $3', [ids[10], latest.home, ids[1]])
    const preview = await fetchLeagueDuelDraftPreview(leagueId, seasonId, ids)
    expect(preview.historySeasonIds).toEqual([latest.season, second.season, third.season])
    expect(preview.historySeasonIds).not.toContain(oldest.season)
    const previousPair = partnershipKey(ids[0]!, ids[1]!)
    expect(preview.partnerHistory.map((history) => history.has(previousPair))).toEqual([true, true, false])
    const rawHistory = (await state.client!.rpc('league_duel_partner_history', { p_season_id: seasonId })).data!
    expect(rawHistory.partnerships.find((pair: { poolPlayerIds: [string, string] }) => partnershipKey(...pair.poolPlayerIds) === previousPair).seasonIds).toHaveLength(2)
    expect(preview.partnerHistory.flatMap((history) => [...history])).not.toContain(partnershipKey(ids[0]!, ids[10]!))
    expect(preview.partnerHistory.flatMap((history) => [...history])).not.toContain(partnershipKey(ids[0]!, ids[3]!))
    expect(preview.partnerHistory.flatMap((history) => [...history])).not.toContain(partnershipKey(ids[0]!, ids[7]!))
  })
})
