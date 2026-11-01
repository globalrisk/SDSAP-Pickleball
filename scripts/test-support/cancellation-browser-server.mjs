import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

// Disposable real PostgreSQL and synthetic Auth; never touches the hosted project.
const api = await startLocalSupabase()
process.env.VITE_SUPABASE_URL = api.url
process.env.VITE_SUPABASE_ANON_KEY = 'local-anon-key'
let before
async function scoringSnapshot() {
  return JSON.stringify(await Promise.all(['league_players', 'rating_history', 'rating_state', 'pickle_wallets', 'pickle_transactions'].map(async table =>
    (await api.db.query(`SELECT to_jsonb(row) AS data FROM public.${table} AS row ORDER BY to_jsonb(row)::text`)).rows)))
}
const vite = await createServer({ server: { host: '127.0.0.1', port: 5177, strictPort: true }, plugins: [{
  name: 'cancellation-browser-check', configureServer(server) {
    server.middlewares.use('/__cancellation-check', async (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ scoringUnchanged: await scoringSnapshot() === before,
        matches: (await api.db.query('SELECT id,status,winner_team_id,live_status FROM public.matches ORDER BY id')).rows }))
    })
  },
}] })
try {
  const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.ts')
  const { error } = await supabase.auth.signInWithPassword({ email: 'admin@example.test', password: 'local-test-password' })
  if (error) throw error
  const data = await vite.ssrLoadModule('/src/lib/api.ts')
  const { leagueId, seasonId, players } = api.seeded
  await data.createManyTeamsWithPlayers(seasonId, [0, 2, 4].map(i => ({ name: `Local pair ${i / 2 + 1}`, color: '#008800', poolPlayerIds: [players[i].id, players[i + 1].id] })))
  await data.createSeasonMatches(seasonId)
  const matches = await data.fetchMatches(seasonId, leagueId)
  await data.recordResult(matches[0].id, { winnerTeamId: matches[0].home_team_id, homeScore: 11, awayScore: 7 })
  before = await scoringSnapshot()
  await vite.listen()
  console.log('Cancellation verification: http://127.0.0.1:5177/leagues/duel-verification/matches')
  console.log('Synthetic login: admin@example.test / local-test-password')
} catch (error) { await vite.close(); await api.close(); throw error }
process.on('SIGINT', async () => { await vite.close(); await api.close(); process.exit() })
