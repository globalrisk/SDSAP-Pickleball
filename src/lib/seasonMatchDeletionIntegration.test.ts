import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { createSeason, fetchMatches, recordForfeit, recordResult, setMatchLiveStatus } from './api'
import { archiveWithPicklePoints, fetchPicklePreview, savePickleSettings } from './picklePointsApi'
import { saveSeasonRoster } from './seasonRosterApi'
import { clearUnplayedLeagueDuelFixtures, fetchLeagueDuelDraftPreview, generateLeagueDuelSeasonMatches, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { acceptBet, cancelBet, createBet, fetchBets, fetchWallet, linkPlayerAccount } from './betsApi'
import { deleteSeasonMatchesAndBets, fetchSeasonMatchDeletionPreview } from './seasonMatchDeletionApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
const client = (token?: string) => createClient(api.url, 'local-anon-key', {
  global: { headers: token ? { Authorization: `Bearer ${token}` } : {} }, auth: { persistSession: false, autoRefreshToken: false },
})
beforeEach(async () => { api = await startLocalSupabase(); state.client = client(api.token) }, 20000)
afterEach(async () => { await api?.close() })

async function prepare() {
  const { leagueId, seasonId: historicalSeason, players } = api.seeded!
  async function draftSeason(seasonId: string) {
    await setSeasonFormat(seasonId, 'team_duel')
    const draft = await fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map(p => p.id))
    await saveLeagueDuelDraft(seasonId, draft.drafts[0]!, ['Green', 'Blue'], draft.revision, draft.fingerprint)
    await generateLeagueDuelSeasonMatches(seasonId)
  }
  await draftSeason(historicalSeason)
  await api.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=CASE WHEN duel_sequence_number<=10 THEN home_team_id ELSE away_team_id END WHERE season_id=$1", [historicalSeason])
  await savePickleSettings('season', historicalSeason, { matchPrize: '21000', championPrize: '0' })
  await archiveWithPicklePoints(historicalSeason, (await fetchPicklePreview(historicalSeason)).fingerprint)
  const seasonId = (await createSeason('Deletion season', leagueId, 'team_duel')).id
  await saveSeasonRoster(seasonId, players.map(p => p.id))
  await draftSeason(seasonId)
  const matches = await fetchMatches(seasonId, leagueId)
  const m = matches[0]!
  const participantIds = [...m.home_pool_player_ids!, ...m.away_pool_player_ids!]
  const spectators = players.filter(p => !participantIds.includes(p.id)).slice(0, 3)
  const accounts = []
  for (let i = 0; i < 3; i++) {
    const account = await api.addAccount({ email: `delete-bettor-${i}@example.test` })
    await linkPlayerAccount(spectators[i]!.id, account.email)
    accounts.push(account)
  }
  state.client = client(accounts[0]!.token)
  const accepted = await createBet(m.id, m.home_team_id, '1000', '2000', crypto.randomUUID())
  state.client = client(accounts[1]!.token)
  await acceptBet(accepted, crypto.randomUUID())
  state.client = client(accounts[2]!.token)
  const open = await createBet(m.id, m.away_team_id, '1000', '1000', crypto.randomUUID())
  const cancelled = await createBet(m.id, m.home_team_id, '1000', '1000', crypto.randomUUID())
  await cancelBet(cancelled)
  state.client = client(api.token)
  return { leagueId, seasonId, players, matches, m, accounts, accepted, open }
}

async function preserved(seasonId: string) {
  const result: Record<string, unknown> = {}
  for (const table of ['season_roster', 'teams', 'players', 'player_pool', 'league_players', 'rating_history', 'rating_state', 'pickle_wallets', 'pickle_transactions']) {
    result[table] = (await api.db.query(`SELECT to_jsonb(t) AS data FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows
  }
  result.otherMatches = (await api.db.query('SELECT to_jsonb(m) AS data FROM public.matches m WHERE season_id<>$1 ORDER BY id', [seasonId])).rows
  return result
}

describe('reviewed deletion of an unplayed season and its bets', () => {
  it('deletes all matches and open, accepted and cancelled bets, releases stakes and preserves all financial balances', async () => {
    const s = await prepare()
    const preview = await fetchSeasonMatchDeletionPreview(s.seasonId)
    expect(preview).toMatchObject({ matchCount: 21, betCount: 3, openCount: 1, acceptedCount: 1, canDelete: true })
    expect(Number(preview.releasedPoints)).toBe(4000)
    const before = await preserved(s.seasonId)
    const request = crypto.randomUUID()
    const result = await deleteSeasonMatchesAndBets(preview, request)
    expect(result).toMatchObject({ matchCount: 21, betCount: 3 })
    expect(await deleteSeasonMatchesAndBets(preview, request)).toEqual(result)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toEqual([])
    expect(await fetchBets(s.leagueId)).toEqual([])
    expect(await preserved(s.seasonId)).toEqual(before)
    for (const account of s.accounts) {
      state.client = client(account.token)
      const wallet = await fetchWallet(s.leagueId)
      expect(Number(wallet.balance)).toBeGreaterThanOrEqual(10000)
      expect(wallet.available).toBe(wallet.balance)
      expect(Number(wallet.reserved)).toBe(0)
    }
    state.client = client(api.token)
    const receipt = (await api.db.query<{ matches: unknown[]; bets: unknown[] }>('SELECT matches,bets FROM pickle_private.season_match_deletions WHERE request_id=$1', [request])).rows[0]!
    expect(receipt.matches).toHaveLength(21); expect(receipt.bets).toHaveLength(3)
    await expect(generateLeagueDuelSeasonMatches(s.seasonId)).rejects.toThrow(/DUEL_STALE_DRAFT/)
    const draft = await fetchLeagueDuelDraftPreview(s.leagueId, s.seasonId, s.players.map(p => p.id))
    await saveLeagueDuelDraft(s.seasonId, draft.drafts[0]!, ['New A', 'New B'], draft.revision, draft.fingerprint)
    await generateLeagueDuelSeasonMatches(s.seasonId)
    expect(await deleteSeasonMatchesAndBets(preview, request)).toEqual(result)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(21)
    await expect(deleteSeasonMatchesAndBets(await fetchSeasonMatchDeletionPreview(s.seasonId), request)).rejects.toThrow(/SEASON_DELETE_REQUEST/)
  }, 30000)

  it.each(['new-offer', 'accept', 'cancel'] as const)('rejects a stale review after %s without deleting anything', async change => {
    const s = await prepare()
    const preview = await fetchSeasonMatchDeletionPreview(s.seasonId)
    state.client = client(s.accounts[0]!.token)
    if (change === 'new-offer') await createBet(s.m.id, s.m.home_team_id, '1000', '1000', crypto.randomUUID())
    if (change === 'accept') await acceptBet(s.open, crypto.randomUUID())
    if (change === 'cancel') { state.client = client(s.accounts[2]!.token); await cancelBet(s.open) }
    state.client = client(api.token)
    const before = await preserved(s.seasonId)
    await expect(deleteSeasonMatchesAndBets(preview, crypto.randomUUID())).rejects.toThrow(/SEASON_DELETE_STALE/)
    expect(await preserved(s.seasonId)).toEqual(before)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(21)
    expect((await api.db.query('SELECT * FROM pickle_private.season_match_deletions')).rows).toHaveLength(0)
  }, 30000)

  it.each(['result', 'forfeit', 'playing', 'rating-history'] as const)('protects a season with %s', async kind => {
    const s = await prepare()
    if (kind === 'result') await recordResult(s.m.id, { winnerTeamId: s.m.home_team_id, homeScore: 11, awayScore: 7 })
    if (kind === 'forfeit') await recordForfeit(s.m.id, s.m.home_team_id, s.m.home_team_id, s.m.away_team_id)
    if (kind === 'playing') {
      await api.db.query('UPDATE public.players SET is_present=true WHERE season_id=$1', [s.seasonId])
      await setMatchLiveStatus(s.m.id, 'playing')
    }
    if (kind === 'rating-history') await api.db.query(`INSERT INTO public.rating_history(league_id,pool_player_id,match_id,rating,rating_deviation,sequence)
      SELECT league_id,pool_player_id,$1,rating,rating_deviation,1 FROM public.league_players WHERE league_id=$2 LIMIT 1`, [s.m.id, s.leagueId])
    const preview = await fetchSeasonMatchDeletionPreview(s.seasonId)
    expect(preview.canDelete).toBe(false)
    const before = await preserved(s.seasonId)
    await expect(deleteSeasonMatchesAndBets(preview, crypto.randomUUID())).rejects.toThrow(/SEASON_DELETE_BLOCKED/)
    expect(await preserved(s.seasonId)).toEqual(before)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(21)
  }, 30000)

  it('rolls back the bet deletions and audit receipt if deleting a match fails', async () => {
    const s = await prepare()
    const preview = await fetchSeasonMatchDeletionPreview(s.seasonId)
    const before = await preserved(s.seasonId)
    await api.db.exec(`CREATE FUNCTION public.fail_delete_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated delete failure'; END $$;
      CREATE TRIGGER z_fail_delete_test BEFORE DELETE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.fail_delete_test();`)
    await expect(deleteSeasonMatchesAndBets(preview, crypto.randomUUID())).rejects.toThrow(/Simulated delete failure/)
    expect(await preserved(s.seasonId)).toEqual(before)
    expect(await fetchBets(s.leagueId)).toHaveLength(3)
    expect((await api.db.query('SELECT * FROM pickle_private.season_match_deletions')).rows).toHaveLength(0)
  }, 30000)

  it('requires an administrator, hides the audit and retains ordinary deletion guards', async () => {
    const s = await prepare()
    const preview = await fetchSeasonMatchDeletionPreview(s.seasonId)
    for (const token of [undefined, s.accounts[0]!.token]) {
      state.client = client(token)
      await expect(fetchSeasonMatchDeletionPreview(s.seasonId)).rejects.toMatchObject({ code: '42501' })
      await expect(deleteSeasonMatchesAndBets(preview, crypto.randomUUID())).rejects.toMatchObject({ code: '42501' })
    }
    await expect(api.db.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE authenticated')
      await tx.query('SELECT * FROM pickle_private.season_match_deletions')
    })).rejects.toThrow(/permission denied/)
    state.client = client(api.token)
    await expect(clearUnplayedLeagueDuelFixtures(s.seasonId, s.matches.map(m => m.id))).rejects.toThrow(/foreign key/)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(21)
    expect(await fetchBets(s.leagueId)).toHaveLength(3)
  }, 30000)

  it('also clears round-robin matches without removing teams or another season’s bets', async () => {
    const s = await prepare()
    const rr = (await api.db.query<{ season_id: string }>(`SELECT m.season_id FROM public.matches m
      JOIN public.seasons s ON s.id=m.season_id WHERE s.format='round_robin' LIMIT 1`)).rows[0]!.season_id
    const preview = await fetchSeasonMatchDeletionPreview(rr)
    expect(preview.canDelete).toBe(true)
    await deleteSeasonMatchesAndBets(preview, crypto.randomUUID())
    expect((await api.db.query('SELECT * FROM public.matches WHERE season_id=$1', [rr])).rows).toHaveLength(0)
    expect((await api.db.query('SELECT * FROM public.teams WHERE season_id=$1', [rr])).rows.length).toBeGreaterThan(0)
    expect(await fetchBets(s.leagueId)).toHaveLength(3)
    expect(await fetchMatches(s.seasonId, s.leagueId)).toHaveLength(21)
  }, 30000)
})
