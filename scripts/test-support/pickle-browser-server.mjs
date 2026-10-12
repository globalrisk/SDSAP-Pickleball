import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

// Disposable browser verification only: no live project credentials or data.
const api = await startLocalSupabase()
process.env.VITE_SUPABASE_URL = api.url
process.env.VITE_SUPABASE_ANON_KEY = 'local-anon-key'
const vite = await createServer({ server: { host: '127.0.0.1', port: 5175, strictPort: true } })
try {
  const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.ts')
  const login = await supabase.auth.signInWithPassword({ email: 'admin@example.test', password: 'local-test-password' })
  if (login.error) throw login.error
  const duel = await vite.ssrLoadModule('/src/lib/leagueTeamDuelApi.ts')
  const app = await vite.ssrLoadModule('/src/lib/api.ts')
  const { leagueId, seasonId, players } = api.seeded
  await duel.setSeasonFormat(seasonId, 'team_duel')
  const draft = await duel.fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map((p) => p.id))
  await duel.saveLeagueDuelDraft(seasonId, draft.drafts[0], ['Local Green', 'Local Blue'], draft.revision, draft.fingerprint)
  await app.createSeasonMatches(seasonId)
  await api.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=CASE WHEN duel_sequence_number<=8 THEN home_team_id ELSE away_team_id END WHERE season_id=$1", [seasonId])
  await vite.listen()
  console.log('Disposable prize verification: http://127.0.0.1:5175/leagues/duel-verification/login')
  console.log('Login: admin@example.test / local-test-password. Close this process to discard all test data.')
} catch (error) {
  await vite.close(); await api.close(); throw error
}
process.on('SIGINT', async () => { await vite.close(); await api.close(); process.exit() })
