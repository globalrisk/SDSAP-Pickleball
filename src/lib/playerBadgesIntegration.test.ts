import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  rpc: (name: string, args: Record<string, unknown>) => state.client!.rpc(name, args),
  from: (name: string) => state.client!.from(name),
} }))
import { fetchPlayerTitlesMap, updatePlayerBadge } from './api'
import { linkPlayerAccount, unlinkPlayerAccount } from './betsApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
let league: string, player: string
const client = (token?: string) => createClient(api.url, 'local-anon-key', { global: { headers: token ? { Authorization: `Bearer ${token}` } : {} }, auth: { persistSession: false, autoRefreshToken: false } })
beforeAll(async () => {
  api = await startLocalSupabase()
  league = api.seeded!.leagueId
  player = api.seeded!.players[0]!.id
}, 20000)
afterAll(async () => { await api?.close() })

describe('Player and administrator badges', () => {
  it('starts empty, saves arbitrary Unicode text, edits it, and clears it without generated fallbacks', async () => {
    state.client = client(api.token)
    expect(await fetchPlayerTitlesMap(league)).toEqual(new Map())
    await updatePlayerBadge(league, player, '  Bậc thầy phòng thủ 🏓  ')
    state.client = client()
    expect((await fetchPlayerTitlesMap(league)).get(player)).toEqual({ label: 'Bậc thầy phòng thủ 🏓' })
    state.client = client(api.token)
    await updatePlayerBadge(league, player, 'Kitchen Captain')
    expect((await fetchPlayerTitlesMap(league)).get(player)?.label).toBe('Kitchen Captain')
    const other = '11111111-1111-4111-8111-111111111111'
    await api.db.query('INSERT INTO public.league_players(league_id,pool_player_id) VALUES($1,$2)', [other, player])
    expect(await fetchPlayerTitlesMap(other)).toEqual(new Map())
    await updatePlayerBadge(other, player, 'Other league badge')
    await updatePlayerBadge(league, player, '   ')
    expect(await fetchPlayerTitlesMap(league)).toEqual(new Map())
    expect((await fetchPlayerTitlesMap(other)).get(player)?.label).toBe('Other league badge')
  })

  it('rejects anonymous and unlinked accounts, including forged user metadata', async () => {
    state.client = client()
    await expect(updatePlayerBadge(league, player, 'Unauthorized')).rejects.toMatchObject({ code: '42501' })
    const user = await api.addAccount({ email: 'badge-player@example.test' })
    state.client = client(user.token)
    await expect(updatePlayerBadge(league, player, 'Unauthorized')).rejects.toMatchObject({ code: '42501' })
    expect(await fetchPlayerTitlesMap(league)).toEqual(new Map())
    await api.db.exec(`BEGIN; SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${user.id}","user_metadata":{"role":"admin"}}', true);
      UPDATE public.league_players SET badge='Forged' WHERE pool_player_id='${player}';
      RESET ROLE;`)
    expect((await api.db.query('SELECT badge FROM public.league_players WHERE league_id=$1 AND pool_player_id=$2', [league, player])).rows[0]).toEqual({ badge: null })
    await api.db.exec('ROLLBACK')
  })

  it('lets linked players edit and clear only their own badge, scoped to each league', async () => {
    const owner = await api.addAccount({ email: 'badge-owner@example.test' })
    const otherPlayer = api.seeded!.players[1]!.id
    const otherLeague = '11111111-1111-4111-8111-111111111111'
    state.client = client(api.token)
    await linkPlayerAccount(player, owner.email)
    state.client = client(owner.token)
    await updatePlayerBadge(league, player, '  My badge 🏓  ')
    expect((await fetchPlayerTitlesMap(league)).get(player)?.label).toBe('My badge 🏓')
    await updatePlayerBadge(otherLeague, player, 'Second league')
    await updatePlayerBadge(league, player, 'Updated badge')
    expect((await fetchPlayerTitlesMap(otherLeague)).get(player)?.label).toBe('Second league')
    await expect(updatePlayerBadge(league, otherPlayer, 'Stolen')).rejects.toMatchObject({ code: '42501' })
    await expect(updatePlayerBadge(league, player, '🏓'.repeat(61))).rejects.toMatchObject({ code: '22023' })
    expect((await fetchPlayerTitlesMap(league)).get(player)?.label).toBe('Updated badge')
    await expect(updatePlayerBadge(crypto.randomUUID(), player, 'Missing membership')).rejects.toMatchObject({ code: 'P0002' })
    // Badge access must not grant direct membership/rating writes, even to the owner.
    const before = (await api.db.query<{ rating: number; status: string }>('SELECT rating, status FROM public.league_players WHERE league_id=$1 AND pool_player_id=$2', [league, player])).rows[0]
    await api.db.exec(`BEGIN; SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${owner.id}","user_metadata":{"role":"admin"}}', true);
      UPDATE public.league_players SET badge='Forged', rating=9999, status='inactive' WHERE pool_player_id='${player}';
      RESET ROLE;`)
    expect((await api.db.query('SELECT rating, status, badge FROM public.league_players WHERE league_id=$1 AND pool_player_id=$2', [league, player])).rows[0]).toEqual({ ...before, badge: 'Updated badge' })
    await api.db.exec('ROLLBACK')
    await updatePlayerBadge(league, player, '   ')
    expect((await fetchPlayerTitlesMap(league)).has(player)).toBe(false)
    state.client = client(api.token)
    await unlinkPlayerAccount(player, owner.email, crypto.randomUUID())
    state.client = client(owner.token)
    await expect(updatePlayerBadge(league, player, 'After unlink')).rejects.toMatchObject({ code: '42501' })
  })

  it('enforces the length and membership bounds without losing an existing badge', async () => {
    state.client = client(api.token)
    await updatePlayerBadge(league, player, 'A'.repeat(60))
    await expect(updatePlayerBadge(league, player, 'A'.repeat(61))).rejects.toMatchObject({ code: '22023' })
    expect((await fetchPlayerTitlesMap(league)).get(player)?.label).toHaveLength(60)
    await expect(updatePlayerBadge(league, crypto.randomUUID(), 'Missing')).rejects.toMatchObject({ code: 'P0002' })
    await expect(api.db.query('UPDATE public.league_players SET badge=$1 WHERE league_id=$2 AND pool_player_id=$3', [' ', league, player])).rejects.toMatchObject({ code: '23514' })
  })
})
