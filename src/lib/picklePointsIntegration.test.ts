import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
import { parseBootstrapArgs } from '../../scripts/bootstrap-season13-pickle.mjs'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) { return state.client!.from(table) },
  rpc(name: string, args: Record<string, unknown>) { return state.client!.rpc(name, args) },
} }))
import { archiveWithPicklePoints, fetchLeaguePickleLeaderboard, fetchPickleContributions, fetchPicklePreview, fetchPickleSettings, savePickleSettings } from './picklePointsApi'
import { addExistingPlayerToLeague } from './leagueApi'
import { createSeason, createSeasonMatches, fetchMatches, recordResult } from './api'
import { fetchLeagueDuelDraftPreview, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { saveSeasonRoster } from './seasonRosterApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
beforeAll(async () => {
  api = await startLocalSupabase()
  state.client = createClient(api.url, 'local-anon-key', { global: { headers: { Authorization: `Bearer ${api.token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
}, 20000)
afterAll(async () => { await api?.close() })

describe('Pickle prizes through application APIs and real PostgreSQL', () => {
  it('saves rules, previews, atomically archives, and keeps league balances independent', async () => {
    const { leagueId, seasonId, players } = api.seeded!
    expect((await fetchPickleSettings(leagueId, seasonId)).season).toMatchObject({ configured: false, matchPrize: '0' })
    await savePickleSettings('league', leagueId, { matchPrize: '20000', championPrize: '200000' })
    await savePickleSettings('season', seasonId, { matchPrize: '10000', championPrize: '100000' })
    expect((await fetchPickleSettings(leagueId, seasonId)).season).toMatchObject({ matchPrize: '10000', configured: true })
    await setSeasonFormat(seasonId, 'team_duel')
    const draft = await fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map((p) => p.id))
    await saveLeagueDuelDraft(seasonId, draft.drafts[0]!, ['Prize green', 'Prize blue'], draft.revision, draft.fingerprint)
    await createSeasonMatches(seasonId)
    const provisional = await fetchPicklePreview(seasonId)
    expect(provisional.complete).toBe(false)
    expect(provisional.squads.every((squad) => squad.championTotal === null)).toBe(true)
    await expect(archiveWithPicklePoints(seasonId, provisional.fingerprint)).rejects.toMatchObject({ message: expect.stringContaining('PICKLE_NOT_READY') })
    await api.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=CASE WHEN duel_sequence_number<=8 THEN home_team_id ELSE away_team_id END WHERE season_id=$1", [seasonId])
    const final = await fetchPicklePreview(seasonId)
    expect(final.squads.map((s) => s.wins).sort((a, b) => a - b)).toEqual([8, 13])
    await savePickleSettings('season', seasonId, { matchPrize: '20000', championPrize: '100000' })
    await expect(archiveWithPicklePoints(seasonId, final.fingerprint)).rejects.toMatchObject({ code: '40001' })
    await savePickleSettings('season', seasonId, { matchPrize: '10000', championPrize: '100000' })
    const reviewed = await fetchPicklePreview(seasonId)
    const [one, retry] = await Promise.all([archiveWithPicklePoints(seasonId, reviewed.fingerprint), archiveWithPicklePoints(seasonId, reviewed.fingerprint)])
    expect(one).toEqual(retry)
    expect(one.season.status).toBe('archived')
    expect((await fetchPicklePreview(seasonId)).awarded).toBe(true)
    const zeroMember = (await api.db.query<{ id: string }>("INSERT INTO public.player_pool(name) VALUES('Inactive zero points') RETURNING id")).rows[0]!
    await addExistingPlayerToLeague(leagueId, zeroMember.id, 1500)
    await api.db.query("UPDATE public.league_players SET status='inactive' WHERE league_id=$1 AND pool_player_id=$2", [leagueId, zeroMember.id])
    const rankings = await fetchLeaguePickleLeaderboard(leagueId)
    expect(rankings).toHaveLength(players.length + 1)
    for (const squad of reviewed.squads) {
      for (const member of squad.members) {
        expect(rankings.find((p) => p.id === member.id)?.balance).toBe(squad.share)
        expect(await fetchPickleContributions(leagueId, member.id)).toMatchObject([{ season_id: seasonId, amount: squad.share }])
      }
    }
    const zeroRows = rankings.filter((row) => row.balance === '0')
    expect(zeroRows.length).toBeGreaterThan(0)
    expect(new Set(zeroRows.map((row) => row.rank)).size).toBe(1)
    const leagueRows = await fetchLeaguePickleLeaderboard(leagueId)
    expect(leagueRows.map((row) => row.id).sort()).toEqual([...players.map((player) => player.id), zeroMember.id].sort())
    expect(leagueRows.find((row) => row.id === zeroMember.id)).toMatchObject({ status: 'inactive', balance: '0' })
    // Joining another league starts this player's points at zero there.
    const defaultLeagueId = '11111111-1111-4111-8111-111111111111'
    const losingMember = reviewed.squads.find((squad) => squad.wins === 8)!.members[0]!
    await addExistingPlayerToLeague(defaultLeagueId, losingMember.id, 1500)
    await api.db.query("UPDATE public.league_players SET status='inactive' WHERE league_id=$1 AND pool_player_id=$2", [defaultLeagueId, losingMember.id])
    const otherRows = await fetchLeaguePickleLeaderboard(defaultLeagueId)
    expect(otherRows.find((row) => row.id === losingMember.id)).toMatchObject({ rank: 1, status: 'inactive', balance: '0' })
    expect(otherRows.every((row) => row.rank === 1 && Number(row.balance) === 0)).toBe(true)
    expect(otherRows.filter((row) => players.some((player) => player.id === row.id)).map((row) => row.id)).toEqual([losingMember.id])
    expect(await fetchPickleContributions(defaultLeagueId, losingMember.id)).toEqual([])
    // Award a second league, then verify both balances and histories independently.
    const otherPlayers = [losingMember.id, ...players.filter((player) => player.id !== losingMember.id).slice(0, 7).map((player) => player.id)]
    for (const id of otherPlayers.filter((id) => id !== losingMember.id)) await addExistingPlayerToLeague(defaultLeagueId, id, 1500)
    await api.db.query("UPDATE public.league_players SET status='active' WHERE league_id=$1 AND pool_player_id=$2", [defaultLeagueId, losingMember.id])
    const originalDefaultSeason = (await api.db.query<{ id: string }>("SELECT id FROM public.seasons WHERE league_id=$1 AND status='active'", [defaultLeagueId])).rows[0]!
    await archiveWithPicklePoints(originalDefaultSeason.id)
    const otherSeason = await createSeason('Independent prizes', defaultLeagueId, 'team_duel')
    await saveSeasonRoster(otherSeason.id, otherPlayers)
    const otherDraft = await fetchLeagueDuelDraftPreview(defaultLeagueId, otherSeason.id, otherPlayers)
    await saveLeagueDuelDraft(otherSeason.id, otherDraft.drafts[0]!, ['Other green', 'Other blue'], otherDraft.revision, otherDraft.fingerprint)
    await createSeasonMatches(otherSeason.id)
    await api.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=home_team_id WHERE season_id=$1", [otherSeason.id])
    await savePickleSettings('season', otherSeason.id, { matchPrize: '2000', championPrize: '0' })
    const otherAward = await fetchPicklePreview(otherSeason.id)
    await archiveWithPicklePoints(otherSeason.id, otherAward.fingerprint)
    expect(await fetchLeaguePickleLeaderboard(leagueId)).toEqual(rankings)
    const afterOtherAward = await fetchLeaguePickleLeaderboard(defaultLeagueId)
    for (const squad of otherAward.squads) for (const member of squad.members) {
      expect(afterOtherAward.find((row) => row.id === member.id)?.balance).toBe(squad.share)
      expect(await fetchPickleContributions(defaultLeagueId, member.id)).toMatchObject([{ season_id: otherSeason.id, amount: squad.share }])
      expect(await fetchPickleContributions(leagueId, member.id)).toHaveLength(1)
    }
    await expect(savePickleSettings('season', seasonId, { matchPrize: '0', championPrize: '0' })).rejects.toMatchObject({ message: expect.stringContaining('PICKLE_FINAL') })
    const match = (await fetchMatches(seasonId, leagueId))[0]!
    const ratingsBefore = (await api.db.query('SELECT revision FROM public.rating_state WHERE league_id=$1', [leagueId])).rows
    await expect(recordResult(match.id, { winnerTeamId: match.home_team_id, homeScore: 11, awayScore: 6 })).rejects.toMatchObject({ message: expect.stringContaining('PICKLE_FINAL') })
    expect((await api.db.query('SELECT revision FROM public.rating_state WHERE league_id=$1', [leagueId])).rows).toEqual(ratingsBefore)
    const next = await createSeason('Copied prizes', leagueId, 'team_duel')
    expect((await fetchPickleSettings(leagueId, next.id)).season).toMatchObject({ matchPrize: '20000', championPrize: '200000', configured: false })
  }, 30000)
  it('rejects unconfigured script amounts before connecting', () => {
    expect(parseBootstrapArgs(['--help']).help).toBe(true)
    expect(parseBootstrapArgs(['--match-prize', '10000', '--champion-prize', '100000']).apply).toBe(false)
    expect(parseBootstrapArgs(['--match-prize', '0', '--champion-prize', '0', '--apply']).apply).toBe(true)
    for (const args of [[], ['--match-prize', '1000'], ['--match-prize', '1500', '--champion-prize', '0'], ['--match-prize', '1e3', '--champion-prize', '0']]) expect(() => parseBootstrapArgs(args)).toThrow()
  })
})
