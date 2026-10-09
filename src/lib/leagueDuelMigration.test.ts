/// <reference types="node" />
import { describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { fetchMatches, recordResult } from './api'
import { fetchLeagueDuelDraftPreview, generateLeagueDuelSeasonMatches, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { saveSeasonRoster } from './seasonRosterApi'

const migration = '20261002170215_league_duel_tier_partnerships.sql'

describe('tier migration over populated mirror history', () => {
  it('preserves all stored data, keeps mirror results valid, and rebuilds only an empty target draft', async () => {
    const api = await startLocalSupabase({ beforeMigration: migration })
    try {
      state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
      const { leagueId, seasonId, players } = api.seeded!
      async function legacyDraft(league: string, season: string) {
        await setSeasonFormat(season, 'team_duel')
        const snapshot = (await state.client!.rpc('league_duel_rating_snapshot', { p_league_id: league })).data!
        const saved = await state.client!.rpc('save_league_duel_draft_atomic', {
          p_season_id: season, p_expected_rating_revision: snapshot.revision, p_expected_rating_fingerprint: snapshot.fingerprint,
          p_squads: [players.slice(0, 7), players.slice(7)].map((squad, i) => ({ name: `Legacy ${i}`, color: '#15803d', poolPlayerIds: squad.map((p) => p.id) })),
        })
        expect(saved.error).toBeNull()
      }
      await legacyDraft(leagueId, seasonId)
      const generation = await state.client!.rpc('generate_league_duel_matches_atomic', { p_season_id: seasonId })
      expect(generation.error).toBeNull()
      expect(generation.data).toBe(21)
      const fixtures = await fetchMatches(seasonId, leagueId)
      const first = fixtures[0]!
      await recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 7 })

      const otherLeague = randomUUID(), emptySeason = randomUUID()
      await api.db.query('SELECT public.create_league_atomic($1,$2,$3,$4,$5,$6,$7,$8)', [otherLeague, `empty-draft-${otherLeague}`, 'Empty draft', emptySeason, 'Season 13 fixture-free copy',
        JSON.stringify(players.map((player) => ({ ...player, is_new: false }))), '[]', '[]'])
      await saveSeasonRoster(emptySeason, players.map((p) => p.id))
      await legacyDraft(otherLeague, emptySeason)
      const originalRoster = (await api.db.query('SELECT * FROM public.season_roster WHERE season_id = $1 ORDER BY pool_player_id', [emptySeason])).rows
      const originalSeason = (await api.db.query('SELECT to_jsonb(s) - ARRAY[\'duel_draft_rating_revision\', \'duel_draft_rating_fingerprint\'] AS data FROM public.seasons s WHERE id = $1', [emptySeason])).rows
      const storedData = async () => {
        const data: Record<string, unknown> = {}
        for (const table of ['seasons', 'season_roster', 'teams', 'players', 'matches', 'league_players', 'player_pool', 'rating_state', 'rating_history']) {
          data[table] = (await api.db.query(`SELECT to_jsonb(t) - ARRAY['duel_tier','duel_schedule_mode','duel_draft_priority'] AS data FROM public.${table} t ORDER BY (to_jsonb(t) - ARRAY['duel_tier','duel_schedule_mode','duel_draft_priority'])::text`)).rows
        }
        return data
      }
      const before = await storedData()
      for (const file of (await readdir('supabase/migrations')).filter((file) => file >= migration && file.endsWith('.sql')).sort()) {
        await api.db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
      }
      expect(await storedData()).toEqual(before)
      expect((await state.client!.rpc('validate_league_duel_season', { p_season_id: seasonId })).error).toBeNull()
      const lineups = (games: typeof fixtures) => games.map((game) => [game.id, game.home_pool_player_ids, game.away_pool_player_ids]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      expect(lineups(await fetchMatches(seasonId, leagueId))).toEqual(lineups(fixtures))
      await recordResult(first.id, { winnerTeamId: first.away_team_id, homeScore: 8, awayScore: 11 })
      expect((await fetchMatches(seasonId, leagueId)).find((game) => game.id === first.id)?.winner_team_id).toBe(first.away_team_id)
      const frozenHistory = await fetchMatches(seasonId, leagueId)
      await expect(generateLeagueDuelSeasonMatches(emptySeason)).rejects.toThrow(/tier-matched draft/)
      const preview = await fetchLeagueDuelDraftPreview(otherLeague, emptySeason, players.map((p) => p.id))
      await saveLeagueDuelDraft(emptySeason, preview.drafts[0]!, ['Fresh A', 'Fresh B'], preview.revision, preview.fingerprint)
      expect(await generateLeagueDuelSeasonMatches(emptySeason)).toBe(21)
      expect((await api.db.query('SELECT * FROM public.season_roster WHERE season_id = $1 ORDER BY pool_player_id', [emptySeason])).rows).toEqual(originalRoster)
      expect((await api.db.query('SELECT to_jsonb(s) - ARRAY[\'duel_schedule_mode\', \'duel_draft_priority\', \'duel_draft_rating_revision\', \'duel_draft_rating_fingerprint\'] AS data FROM public.seasons s WHERE id = $1', [emptySeason])).rows).toEqual(originalSeason)
      expect(await fetchMatches(seasonId, leagueId)).toEqual(frozenHistory)
    } finally { await api.close() }
  }, 30000)
})
