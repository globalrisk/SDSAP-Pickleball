import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

// Synthetic accounts and real migrations in disposable PostgreSQL, loopback only.
const api=await startLocalSupabase()
process.env.VITE_SUPABASE_URL=api.url
process.env.VITE_SUPABASE_ANON_KEY='local-anon-key'
const vite=await createServer({server:{host:'127.0.0.1',port:5176,strictPort:true}})
try {
  const {supabase}=await vite.ssrLoadModule('/src/lib/supabase.ts')
  const {error}=await supabase.auth.signInWithPassword({email:'admin@example.test',password:'local-test-password'})
  if(error)throw error
  const app=await vite.ssrLoadModule('/src/lib/api.ts')
  const duel=await vite.ssrLoadModule('/src/lib/leagueTeamDuelApi.ts')
  const prizes=await vite.ssrLoadModule('/src/lib/picklePointsApi.ts')
  const roster=await vite.ssrLoadModule('/src/lib/seasonRosterApi.ts')
  const bets=await vite.ssrLoadModule('/src/lib/betsApi.ts')
  const {leagueId,seasonId:history,players}=api.seeded
  const draftSeason=async(seasonId)=>{
    await duel.setSeasonFormat(seasonId,'team_duel')
    const draft=await duel.fetchLeagueDuelDraftPreview(leagueId,seasonId,players.map(p=>p.id))
    await duel.saveLeagueDuelDraft(seasonId,draft.drafts[0],['Local Green','Local Blue'],draft.revision,draft.fingerprint)
    await app.createSeasonMatches(seasonId)
  }
  await draftSeason(history)
  await api.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=CASE WHEN duel_sequence_number<=8 THEN home_team_id ELSE away_team_id END WHERE season_id=$1",[history])
  await prizes.savePickleSettings('season',history,{matchPrize:'21000',championPrize:'0'})
  await prizes.archiveWithPicklePoints(history,(await prizes.fetchPicklePreview(history)).fingerprint)
  const seasonId=(await app.createSeason('Bets verification season',leagueId,'team_duel')).id
  await roster.saveSeasonRoster(seasonId,players.map(p=>p.id))
  await draftSeason(seasonId)
  const matches=await app.fetchMatches(seasonId,leagueId)
  const match=matches[0]
  const ids=[...match.home_pool_player_ids,...match.away_pool_player_ids]
  const spectators=players.filter(p=>!ids.includes(p.id))
  await api.addAccount({email:'alex@example.test'})
  const bo=await api.addAccount({email:'bo@example.test'})
  // Leave Alex unlinked so browser verification exercises the admin linking UI.
  await bets.linkPlayerAccount(spectators[1].id,bo.email)
  await vite.listen()
  console.log('Disposable bets verification: http://127.0.0.1:5176/leagues/duel-verification/login')
  console.log('Synthetic logins: admin@example.test / alex@example.test / bo@example.test; password: local-test-password')
  console.log(`Link Alex to ${spectators[0].name}; Bo is linked to ${spectators[1].name}. First match: ${match.home_team.players.map(p=>p.name).join(' + ')} vs ${match.away_team.players.map(p=>p.name).join(' + ')}`)
} catch(error){await vite.close();await api.close();throw error}
process.on('SIGINT',async()=>{await vite.close();await api.close();process.exit()})
