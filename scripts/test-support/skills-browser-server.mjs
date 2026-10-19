import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

// Synthetic accounts and real SQL in a disposable database; no hosted data.
const api = await startLocalSupabase()
process.env.VITE_SUPABASE_URL = api.url
process.env.VITE_SUPABASE_ANON_KEY = 'local-anon-key'
const vite = await createServer({
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  plugins: [{
    name: 'disposable-skill-save-failure',
    configureServer(server) {
      // Register before Vite's SPA fallback; this exists only in the test fixture.
      server.middlewares.use('/__test/fail-next-skill-save', (_request, response) => {
        api.failNextSkillSave()
        response.end('The next synthetic skill save will fail once.')
      })
    },
  }],
})
try {
  const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.ts')
  const { linkPlayerAccount } = await vite.ssrLoadModule('/src/lib/betsApi.ts')
  const { leagueId, players } = api.seeded
  const linked = []
  await supabase.auth.signInWithPassword({ email: 'admin@example.test', password: 'local-test-password' })
  for (const [index, email] of ['skills-target@example.test', 'skills@example.test', 'skills-peer@example.test', 'skills-empty@example.test'].entries()) {
    const account = await api.addAccount({ email })
    await linkPlayerAccount(players[index].id, email)
    linked.push(account)
  }
  await api.addAccount({ email: 'skills-unlinked@example.test' })
  await supabase.auth.signInWithPassword({ email: linked[2].email, password: linked[2].password })
  const save = async (playerId, scores) => {
    const { error } = await supabase.rpc('save_player_skill_rating', { p_league_id: leagueId, p_player_id: playerId, p_scores: scores })
    if (error) throw error
  }
  await save(players[0].id, { drive: 85, drop: 72, serve: 80, dink: 68, return: 76, volley: 82, lob: 55, reset: 74, overhead: 88,
    footwork: 78, hand_speed: 86, stamina: 70, positioning: 75, shot_selection: 82, game_iq: 80, mental_game: 90, teamwork: 85, consistency: 77 })
  await save(players[1].id, { drive: 0, serve: 100, dink: 63, footwork: 0, mental_game: 100, positioning: 65 })
  await vite.listen()
  console.log(`Skill verification: http://127.0.0.1:5178/leagues/duel-verification/players/${players[0].id}`)
  console.log(`Empty profile: http://127.0.0.1:5178/leagues/duel-verification/players/${players[3].id}`)
  console.log(`Unlinked recipient: http://127.0.0.1:5178/leagues/duel-verification/players/${players[4].id}`)
  console.log('Disposable accounts: skills@example.test (rater), skills-target@example.test, skills-peer@example.test, skills-empty@example.test, skills-unlinked@example.test; password: local-test-password')
} catch (error) { await vite.close(); await api.close(); throw error }
process.on('SIGINT', async () => { await vite.close(); await api.close(); process.exit() })
