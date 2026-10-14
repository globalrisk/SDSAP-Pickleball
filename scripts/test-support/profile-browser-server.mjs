import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

// Real migrations and application RPCs; synthetic Auth and disposable local data only.
const api = await startLocalSupabase()
process.env.VITE_SUPABASE_URL = api.url
process.env.VITE_SUPABASE_ANON_KEY = 'local-anon-key'
const vite = await createServer({ server: { host: '127.0.0.1', port: 5177, strictPort: true } })
try {
  const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.ts')
  const login = await supabase.auth.signInWithPassword({ email: 'admin@example.test', password: 'local-test-password' })
  if (login.error) throw login.error
  const app = await vite.ssrLoadModule('/src/lib/api.ts')
  const duel = await vite.ssrLoadModule('/src/lib/leagueTeamDuelApi.ts')
  const prizes = await vite.ssrLoadModule('/src/lib/picklePointsApi.ts')
  const roster = await vite.ssrLoadModule('/src/lib/seasonRosterApi.ts')
  const bets = await vite.ssrLoadModule('/src/lib/betsApi.ts')
  const { leagueId, seasonId: historical, players } = api.seeded
  const draftSeason = async (id) => {
    await duel.setSeasonFormat(id, 'team_duel')
    const draft = await duel.fetchLeagueDuelDraftPreview(leagueId, id, players.map(player => player.id))
    await duel.saveLeagueDuelDraft(id, draft.drafts[0], ['Profile Green', 'Profile Blue'], draft.revision, draft.fingerprint)
    await app.createSeasonMatches(id)
  }
  await draftSeason(historical)
  const historyMatches = await app.fetchMatches(historical, leagueId)
  const first = historyMatches[0]
  await app.recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 7 })
  await api.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=CASE WHEN duel_sequence_number<=8 THEN home_team_id ELSE away_team_id END WHERE season_id=$1 AND status='scheduled'", [historical])
  await prizes.savePickleSettings('season', historical, { matchPrize: '21000', championPrize: '70000' })
  await prizes.archiveWithPicklePoints(historical, (await prizes.fetchPicklePreview(historical)).fingerprint)
  const season = await app.createSeason('Profile current season', leagueId, 'team_duel')
  await roster.saveSeasonRoster(season.id, players.map(player => player.id))
  await draftSeason(season.id)
  const playerId = first.home_pool_player_ids[0]
  const currentMatches = (await app.fetchMatches(season.id, leagueId)).filter(match => [...match.home_pool_player_ids, ...match.away_pool_player_ids].includes(playerId))
  const result = currentMatches[0]
  await app.recordResult(result.id, { winnerTeamId: result.away_team_id, homeScore: 8, awayScore: 11 })
  await app.recordForfeit(currentMatches[1].id, currentMatches[1].home_team_id, currentMatches[1].home_team_id, currentMatches[1].away_team_id)
  await api.db.query('UPDATE public.players SET is_present=true WHERE team_id IN (SELECT id FROM public.teams WHERE season_id=$1)', [season.id])
  await api.db.query("UPDATE public.matches SET live_status='playing',live_court_number=1 WHERE id=$1", [currentMatches[2].id])
  const linked = await api.addAccount({ email: 'profile@example.test' })
  await bets.linkPlayerAccount(playerId, linked.email)
  await api.addAccount({ email: 'unlinked@example.test' })
  await vite.listen()
  console.log('Profile verification: http://127.0.0.1:5177/leagues/duel-verification/me')
  console.log('Disposable accounts: profile@example.test (linked), unlinked@example.test, admin@example.test; password: local-test-password')
} catch (error) { await vite.close(); await api.close(); throw error }
process.on('SIGINT', async () => { await vite.close(); await api.close(); process.exit() })
