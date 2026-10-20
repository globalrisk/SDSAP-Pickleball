import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  rpc: (name: string, args: Record<string, unknown>) => state.client!.rpc(name, args),
} }))
import { renameMyPlayer } from './playerNameApi'
import { cancelBet, createBet, fetchBets, fetchMyPlayerAccount, fetchWallet, linkPlayerAccount, unlinkPlayerAccount } from './betsApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
const client = (token?: string) => createClient(api.url, 'local-anon-key', {
  global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  auth: { persistSession: false, autoRefreshToken: false },
})
let owner: Awaited<ReturnType<typeof api.addAccount>>
let playerId: string, otherId: string
beforeAll(async () => {
  api = await startLocalSupabase()
  playerId = api.seeded!.players[0]!.id
  otherId = api.seeded!.players[1]!.id
  owner = await api.addAccount({ email: 'rename-owner@example.test' })
  state.client = client(api.token)
  await linkPlayerAccount(playerId, owner.email)
}, 20000)
afterAll(async () => { await api?.close() })

describe('Linked player self-service names', () => {
  it('allows repeated Unicode renames and syncs historical league rosters without changing player data', async () => {
    const { leagueId, seasonId } = api.seeded!
    const otherLeague = crypto.randomUUID()
    await api.db.query("INSERT INTO public.leagues(id,slug,name) VALUES($1,'rename-other','Other league')", [otherLeague])
    const ids = api.seeded!.players.slice(0, 4).map(player => player.id)
    for (const id of ids) await api.db.query('INSERT INTO public.league_players(league_id,pool_player_id) VALUES($1,$2)', [otherLeague, id])
    const secondSeason = crypto.randomUUID()
    await api.db.query("INSERT INTO public.seasons(id,league_id,name,status) VALUES($1,$2,'Other league','active')", [secondSeason, otherLeague])
    const matchId = crypto.randomUUID()
    let homeTeam = ''
    for (const season of [seasonId, secondSeason]) {
      await api.db.exec('BEGIN')
      const home = crypto.randomUUID(), away = crypto.randomUUID()
      for (const [index, team] of [home, away].entries()) {
        await api.db.query("INSERT INTO public.teams(id,season_id,name,color) VALUES($1,$2,$3,'#008800')", [team, season, `Rename team ${index}`])
        for (const id of ids.slice(index * 2, index * 2 + 2)) {
          await api.db.query('INSERT INTO public.players(name,team_id,pool_player_id,season_id) SELECT name,$1,id,$2 FROM public.player_pool WHERE id=$3', [team, season, id])
        }
      }
      if (season === secondSeason) {
        homeTeam = home
        await api.db.query('INSERT INTO public.matches(id,season_id,home_team_id,away_team_id,home_pool_player_ids,away_pool_player_ids) VALUES($1,$2,$3,$4,$5,$6)', [matchId, season, home, away, ids.slice(0, 2), ids.slice(2)])
      }
      await api.db.exec('COMMIT')
    }
    await api.db.query('INSERT INTO public.pickle_wallets(league_id,pool_player_id) VALUES($1,$2)', [otherLeague, playerId])
    await api.db.query("INSERT INTO public.pickle_transactions(league_id,pool_player_id,amount,kind,season_id) VALUES($1,$2,12000,'prize',$3)", [otherLeague, playerId, secondSeason])
    state.client = client(owner.token)
    const betId = await createBet(matchId, homeTeam, '1000', '1000', crypto.randomUUID())
    expect(await fetchWallet(otherLeague)).toMatchObject({ balance: '12000.000000', reserved: '1000.000000' })
    await api.db.query("UPDATE public.seasons SET status='archived' WHERE id=$1", [seasonId])
    await api.db.query("UPDATE public.league_players SET status='inactive' WHERE league_id=$1 AND pool_player_id=$2", [leagueId, playerId])
    const original = (await api.db.query('SELECT to_jsonb(p)-\'name\' AS data FROM public.player_pool p WHERE id=$1', [playerId])).rows
    const rosters = (await api.db.query('SELECT to_jsonb(p)-\'name\' AS data FROM public.players p WHERE pool_player_id=$1 ORDER BY id', [playerId])).rows
    const preserved = async () => {
      const result = []
      for (const table of ['league_players', 'player_accounts', 'matches', 'rating_history', 'rating_state', 'pickle_wallets', 'pickle_bets', 'pickle_transactions']) {
        result.push((await api.db.query(`SELECT to_jsonb(t) AS data FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows)
      }
      return result
    }
    const before = await preserved()
    state.client = client(owner.token)
    for (const name of ['  Nguyễn Trọng 🏓  ', 'Second name', '🏓'.repeat(120)]) {
      const account = await renameMyPlayer(playerId, name)
      expect(account).toEqual({ playerId, name: name.trim() })
      expect(await fetchMyPlayerAccount()).toEqual(account)
      expect((await api.db.query('SELECT name FROM public.players WHERE pool_player_id=$1', [playerId])).rows).toEqual([{ name: name.trim() }, { name: name.trim() }])
    }
    expect((await api.db.query('SELECT to_jsonb(p)-\'name\' AS data FROM public.player_pool p WHERE id=$1', [playerId])).rows).toEqual(original)
    expect((await api.db.query('SELECT to_jsonb(p)-\'name\' AS data FROM public.players p WHERE pool_player_id=$1 ORDER BY id', [playerId])).rows).toEqual(rosters)
    expect(await preserved()).toEqual(before)
    expect((await fetchBets(otherLeague))[0]).toMatchObject({ id: betId, creatorId: playerId, creatorName: '🏓'.repeat(120), state: 'open' })
    await cancelBet(betId)
  })

  it('rejects anonymous callers, unlinked users, other players, and direct rating or name writes', async () => {
    state.client = client()
    await expect(renameMyPlayer(playerId, 'Anonymous')).rejects.toMatchObject({ code: '42501' })
    const unlinked = await api.addAccount({ email: 'rename-unlinked@example.test' })
    state.client = client(unlinked.token)
    await expect(renameMyPlayer(playerId, 'Unlinked')).rejects.toMatchObject({ code: '42501' })
    state.client = client(owner.token)
    await expect(renameMyPlayer(otherId, 'Another player')).rejects.toMatchObject({ code: '42501' })
    // Forging user metadata cannot grant the administrator's direct-write policy.
    await api.db.exec('BEGIN; SET LOCAL ROLE authenticated;')
    await api.db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner.id, role: 'authenticated', user_metadata: { role: 'admin' } })])
    expect((await api.db.query("UPDATE public.player_pool SET name='Forbidden',rating=9999 WHERE id=$1 RETURNING id", [playerId])).rows).toEqual([])
    expect((await api.db.query("UPDATE public.players SET name='Forbidden' WHERE pool_player_id=$1 RETURNING id", [playerId])).rows).toEqual([])
    await api.db.exec('ROLLBACK')
  })

  it('enforces server-side name bounds even when bypassing the form', async () => {
    state.client = client(owner.token)
    const before = await fetchMyPlayerAccount()
    for (const name of [null, '', ' \t\r\n ', 'a'.repeat(121), '🏓'.repeat(121)]) {
      const { error } = await state.client!.rpc('rename_my_player', { p_expected_player_id: playerId, p_name: name })
      expect(error).toMatchObject({ code: '22023' })
      expect(await fetchMyPlayerAccount()).toEqual(before)
    }
  })

  it('rejects stale forms after unlinking or linking the account to another player', async () => {
    state.client = client(api.token)
    await unlinkPlayerAccount(playerId, owner.email, crypto.randomUUID())
    state.client = client(owner.token)
    await expect(renameMyPlayer(playerId, 'Old link')).rejects.toMatchObject({ code: '42501' })
    state.client = client(api.token)
    await linkPlayerAccount(otherId, owner.email)
    state.client = client(owner.token)
    await expect(renameMyPlayer(playerId, 'Stale form')).rejects.toMatchObject({ code: '42501' })
    expect(await renameMyPlayer(otherId, 'New linked player')).toEqual({ playerId: otherId, name: 'New linked player' })
  })
})
