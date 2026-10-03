import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

const api = await startLocalSupabase()
process.env.VITE_SUPABASE_URL = api.url
process.env.VITE_SUPABASE_ANON_KEY = 'local-anon-key'
const stableTables = ['seasons', 'season_roster', 'players', 'matches', 'league_players', 'rating_history', 'rating_state']
async function stableSnapshot() {
  const tables = await Promise.all(stableTables.map(async (table) =>
    (await api.db.query(`SELECT to_jsonb(row) AS data FROM public.${table} AS row ORDER BY to_jsonb(row)::text`)).rows))
  tables.push((await api.db.query('SELECT to_jsonb(team) - \'name\' AS data FROM public.teams AS team ORDER BY id')).rows)
  return JSON.stringify(tables)
}
let before
const vite = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true }, plugins: [{
  name: 'local-rename-check', configureServer(server) {
    server.middlewares.use('/__rename-check', async (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ unchangedData: await stableSnapshot() === before,
        teams: (await api.db.query('SELECT name FROM public.teams ORDER BY name')).rows }))
    })
  },
}] })
const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.ts')
const login = await supabase.auth.signInWithPassword({ email: 'admin@example.test', password: 'local-test-password' })
if (login.error) throw login.error
const duel = await vite.ssrLoadModule('/src/lib/leagueTeamDuelApi.ts')
const data = await vite.ssrLoadModule('/src/lib/api.ts')
const { leagueId, seasonId, players } = api.seeded
await duel.setSeasonFormat(seasonId, 'team_duel')
const preview = await duel.fetchLeagueDuelDraftPreview(leagueId, seasonId, players.map((player) => player.id))
await duel.saveLeagueDuelDraft(seasonId, preview.drafts[0], ['Squad A', 'Squad B'], preview.revision, preview.fingerprint)
await duel.generateLeagueDuelSeasonMatches(seasonId)
const first = (await data.fetchMatches(seasonId, leagueId))[0]
await data.recordResult(first.id, { winnerTeamId: first.home_team_id, homeScore: 11, awayScore: 7 })
before = await stableSnapshot()
await vite.listen()
console.log('Local rename verification ready: http://127.0.0.1:5174/leagues/duel-verification/setup?section=teams')
process.on('SIGINT', async () => { await vite.close(); await api.close(); process.exit() })
