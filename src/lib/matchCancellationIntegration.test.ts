import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { cancelMatch, createManyTeamsWithPlayers, createSeasonMatches, fetchMatches, fetchPlayerRankings, fetchTeamsWithPlayers, recordResult, revertMatchToScheduled, setMatchLiveStatus } from './api'
import { fetchLeagueDuelDraftPreview, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { archiveWithPicklePoints, fetchPicklePreview, savePickleSettings } from './picklePointsApi'
import { computeStandings } from './standings'
import { buildPersonalTournament } from './personalTournament'
import { buildTournamentView } from './tournamentMode'
import { forecastLeagueDuelSeason } from './seasonForecast'
import { getLeagueDuelProgress } from './leagueTeamDuel'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
const client = (token?: string) => createClient(api.url, 'local-anon-key', {
  global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  auth: { persistSession: false, autoRefreshToken: false },
})
beforeAll(async () => { api = await startLocalSupabase(); state.client = client(api.token) }, 20000)
afterAll(async () => { await api?.close() })

describe('cancel an unplayed match without scoring it', () => {
  it('keeps rankings and history exactly unchanged during a round robin already in play', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    await createManyTeamsWithPlayers(seasonId, [0, 2, 4].map(i => ({ name: `Pair ${i}`, color: '#008800', poolPlayerIds: [players[i]!.id, players[i + 1]!.id] })))
    await createSeasonMatches(seasonId)
    const matches = await fetchMatches(seasonId, leagueId)
    const played = matches[0]!, absent = matches[1]!
    await recordResult(played.id, { winnerTeamId: played.home_team_id, homeScore: 11, awayScore: 6 })
    await api.db.query('UPDATE public.players SET is_present=true WHERE season_id=$1', [seasonId])
    await setMatchLiveStatus(absent.id, 'playing')
    const rankings = await fetchPlayerRankings(leagueId)
    const history = (await api.db.query('SELECT * FROM public.rating_history ORDER BY id')).rows
    const revision = (await api.db.query('SELECT * FROM public.rating_state ORDER BY league_id')).rows
    const teams = await fetchTeamsWithPlayers(seasonId)
    const standings = computeStandings(teams, await fetchMatches(seasonId, leagueId))
    await cancelMatch(absent.id)
    await cancelMatch(absent.id) // A lost response can be retried safely.
    const updated = await fetchMatches(seasonId, leagueId)
    expect(updated.find(m => m.id === absent.id)).toMatchObject({ status: 'cancelled', winner_team_id: null, home_score: null, away_score: null, result_recorded_at: null, live_status: 'available', live_court_number: null })
    expect(await fetchPlayerRankings(leagueId)).toEqual(rankings)
    expect((await api.db.query('SELECT * FROM public.rating_history ORDER BY id')).rows).toEqual(history)
    expect((await api.db.query('SELECT * FROM public.rating_state ORDER BY league_id')).rows).toEqual(revision)
    expect(computeStandings(teams, updated)).toEqual(standings)
    expect(buildTournamentView(updated).recentResult?.id).toBe(played.id)
    const participantId = teams.find(t => t.id === absent.home_team_id)!.players[0]!.pool_player_id
    const personal = buildPersonalTournament(participantId, seasonId, updated, [])
    expect(personal.results.find(m => m.id === absent.id)?.status).toBe('cancelled')
    expect(personal.remainingMatches.some(m => m.id === absent.id)).toBe(false)
    await expect(recordResult(absent.id, { winnerTeamId: absent.home_team_id, homeScore: 11, awayScore: 5 })).rejects.toMatchObject({ message: expect.stringContaining('MATCH_CANCELLED') })
    await expect(revertMatchToScheduled(absent.id)).rejects.toMatchObject({ message: expect.stringContaining('MATCH_CANCELLED') })
    await expect(cancelMatch(played.id)).rejects.toMatchObject({ message: expect.stringContaining('MATCH_CANCEL') })
  })

  it('releases open and accepted stakes without changing wallets or settling a winner', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    const match = (await fetchMatches(seasonId, leagueId)).find(m => m.status === 'scheduled')!
    // Seed reservations only; the cancellation itself runs through the real authenticated RPC.
    const betId = crypto.randomUUID(), openId = crypto.randomUUID()
    for (const [id, state, acceptor] of [[betId, 'accepted', players[12]!.id], [openId, 'open', null]]) {
      await api.db.query(`INSERT INTO public.pickle_bets(id,league_id,season_id,match_id,creator_id,creator_side,creator_stake,acceptor_stake,acceptor_id,state,home_ids,away_ids,creator_request,home_team_id,away_team_id)
        VALUES($1,$2,$3,$4,$5,$6,1000,2000,$7,$8,$9,$10,$11,$6,$12)`, [id, leagueId, seasonId, match.id, players[13]!.id, match.home_team_id, acceptor, state,
        teamsIds(match.home_team.players), teamsIds(match.away_team.players), crypto.randomUUID(), match.away_team_id])
    }
    const wallets = (await api.db.query('SELECT * FROM public.pickle_wallets ORDER BY league_id,pool_player_id')).rows
    const ledger = (await api.db.query('SELECT * FROM public.pickle_transactions ORDER BY id')).rows
    await cancelMatch(match.id)
    expect((await api.db.query('SELECT state,close_reason FROM public.pickle_bets WHERE match_id=$1', [match.id])).rows).toEqual([
      { state: 'void', close_reason: 'match_cancelled' }, { state: 'void', close_reason: 'match_cancelled' },
    ])
    expect((await api.db.query('SELECT * FROM public.pickle_wallets ORDER BY league_id,pool_player_id')).rows).toEqual(wallets)
    expect((await api.db.query('SELECT * FROM public.pickle_transactions ORDER BY id')).rows).toEqual(ledger)
    expect((await api.db.query('SELECT * FROM public.pickle_bet_settlements WHERE match_id=$1', [match.id])).rows).toHaveLength(0)
    expect((await api.db.query('SELECT pickle_private.reserved($1,$2) AS reserved', [leagueId, players[13]!.id])).rows[0]).toMatchObject({ reserved: '0' })
  })

  it('rejects unauthenticated and non-admin cancellation', async () => {
    const match = (await fetchMatches(api.seeded!.seasonId, api.seeded!.leagueId))[0]!
    state.client = client()
    await expect(cancelMatch(match.id)).rejects.toMatchObject({ code: '42501' })
    const player = await api.addAccount({ email: 'cancel-player@example.test' })
    state.client = client(player.token)
    await expect(cancelMatch(match.id)).rejects.toMatchObject({ code: '42501' })
    state.client = client(api.token)
  })
})

function teamsIds(players: { pool_player_id: string }[] | undefined) { return players!.map(p => p.pool_player_id) }

describe('cancelled Team Duel fixtures and prizes', () => {
  it.each([false, true])('finishes and archives with no prizes for cancellations (has played game: %s)', async (hasPlayedGame) => {
    const other = await startLocalSupabase()
    try {
      state.client = createClient(other.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${other.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
      const { leagueId, seasonId, players } = other.seeded!
      await setSeasonFormat(seasonId, 'team_duel')
      const preview = await fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map(p => p.id))
      await saveLeagueDuelDraft(seasonId, preview.drafts[0]!, ['Green', 'Blue'], preview.revision, preview.fingerprint)
      await createSeasonMatches(seasonId)
      await savePickleSettings('season', seasonId, { matchPrize: '1000', championPrize: '10000' })
      const original = await fetchMatches(seasonId, leagueId)
      if (hasPlayedGame) await recordResult(original[0]!.id, { winnerTeamId: original[0]!.home_team_id, homeScore: 11, awayScore: 5 })
      for (const match of original.slice(hasPlayedGame ? 1 : 0)) await cancelMatch(match.id)
      const matches = await fetchMatches(seasonId, leagueId)
      const lineups = (fixtures: typeof matches) => [...fixtures].sort((a, b) => a.id.localeCompare(b.id)).map(m => [m.id, m.home_pool_player_ids, m.away_pool_player_ids])
      expect(lineups(matches)).toEqual(lineups(original))
      expect(getLeagueDuelProgress(matches)).toMatchObject({ complete: true, remaining: 0 })
      expect(forecastLeagueDuelSeason(matches, [matches[0]!.home_team_id, matches[0]!.away_team_id])).toMatchObject({ remainingGames: 0, tieProbability: hasPlayedGame ? 0 : 1, expectedHomeWins: hasPlayedGame ? 1 : 0, expectedAwayWins: 0 })
      const prizes = await fetchPicklePreview(seasonId)
      expect(prizes).toMatchObject({ complete: true, valid: true, remaining: 0 })
      expect(prizes.squads.reduce((sum, squad) => sum + Number(squad.matchTotal), 0)).toBe(hasPlayedGame ? 1000 : 0)
      expect(prizes.squads.reduce((sum, squad) => sum + Number(squad.total), 0)).toBe(hasPlayedGame ? 11000 : 0)
      await archiveWithPicklePoints(seasonId, prizes.fingerprint)
      await expect(cancelMatch(matches[0]!.id)).rejects.toMatchObject({ message: expect.stringContaining('active') })
    } finally { state.client = client(api.token); await other.close() }
  }, 30000)
})
