import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
const state=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('./supabase',()=>({supabase:{from(table:string){return state.client!.from(table)},rpc(name:string,args:Record<string,unknown>){return state.client!.rpc(name,args)}}}))
import { acceptBet, cancelBet, confirmSettlement, createBet, fetchBets, fetchMyPlayerAccount, fetchSettlementPreview, fetchWallet, fetchWalletHistory, linkPlayerAccount } from './betsApi'
import { createSeason, createSeasonMatches, fetchMatches, recordForfeit, recordResult } from './api'
import { fetchLeagueDuelDraftPreview, saveLeagueDuelDraft, setSeasonFormat } from './leagueTeamDuelApi'
import { archiveWithPicklePoints, fetchLeaguePickleLeaderboard, fetchPicklePreview, savePickleSettings } from './picklePointsApi'
import { saveSeasonRoster } from './seasonRosterApi'
import { addPoints } from './betsApi'
let api:Awaited<ReturnType<typeof startLocalSupabase>>
const client=(token?:string)=>createClient(api.url,'local-anon-key',{global:{headers:token?{Authorization:`Bearer ${token}`} : {}},auth:{persistSession:false,autoRefreshToken:false}})
beforeAll(async()=>{api=await startLocalSupabase();state.client=client(api.token)},20000)
afterAll(async()=>{await api?.close()})

describe('Player account → bet → review → correction → rankings',()=>{
  it('uses real RPCs with separate player accounts and concurrent API requests',async()=>{
    const {leagueId,seasonId:historicalSeason,players}=api.seeded!
    await setSeasonFormat(historicalSeason,'team_duel')
    const historicalDraft=await fetchLeagueDuelDraftPreview(leagueId,historicalSeason,players.map(p=>p.id))
    await saveLeagueDuelDraft(historicalSeason,historicalDraft.drafts[0]!,['Prize green','Prize blue'],historicalDraft.revision,historicalDraft.fingerprint)
    await createSeasonMatches(historicalSeason)
    await api.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=CASE WHEN duel_sequence_number<=8 THEN home_team_id ELSE away_team_id END WHERE season_id=$1",[historicalSeason])
    await savePickleSettings('season',historicalSeason,{matchPrize:'21000',championPrize:'0'})
    await archiveWithPicklePoints(historicalSeason,(await fetchPicklePreview(historicalSeason)).fingerprint)
    const seasonId=(await createSeason('Bet season',leagueId,'team_duel')).id
    await saveSeasonRoster(seasonId,players.map(p=>p.id))
    await setSeasonFormat(seasonId,'team_duel')
    const draft=await fetchLeagueDuelDraftPreview(leagueId,seasonId,players.map(p=>p.id))
    await saveLeagueDuelDraft(seasonId,draft.drafts[0]!,['Bet green','Bet blue'],draft.revision,draft.fingerprint)
    await createSeasonMatches(seasonId)
    const matches=await fetchMatches(seasonId,leagueId)
    const m=matches[0]!
    const participantIds=[...m.home_pool_player_ids!,...m.away_pool_player_ids!]
    const spectators=players.filter(p=>!participantIds.includes(p.id))
    const a=await api.addAccount({email:'alex@example.test'})
    const b=await api.addAccount({email:'bo@example.test'})
    const c=await api.addAccount({email:'cam@example.test'})
    const own=await api.addAccount({email:'participant@example.test'})
    await linkPlayerAccount(spectators[0]!.id,a.email);await linkPlayerAccount(spectators[1]!.id,b.email);await linkPlayerAccount(spectators[2]!.id,c.email);await linkPlayerAccount(participantIds[0]!,own.email)
    const initial=await fetchLeaguePickleLeaderboard(leagueId)
    const aBalance=initial.find(p=>p.id===spectators[0]!.id)!.balance
    const bBalance=initial.find(p=>p.id===spectators[1]!.id)!.balance
    state.client=client(a.token)
    const signed=await state.client.auth.signInWithPassword({email:a.email,password:a.password});expect(signed.error).toBeNull();expect(signed.data.user?.app_metadata.role).toBe('player')
    expect(await fetchMyPlayerAccount()).toMatchObject({playerId:spectators[0]!.id})
    await expect(linkPlayerAccount(participantIds[1]!,a.email)).rejects.toMatchObject({code:'42501'})
    const request=crypto.randomUUID()
    const [first,retry]=await Promise.all([createBet(m.id,m.home_team_id,'1000','5000',request),createBet(m.id,m.home_team_id,'1000','5000',request)])
    expect(first).toBe(retry);expect(await fetchWallet(leagueId)).toMatchObject({balance:aBalance,reserved:'1000.000000',available:addPoints(aBalance,'-1000')})
    expect((await state.client.from('pickle_wallets').select('*')).data).toHaveLength(1)
    expect((await state.client.from('pickle_wallets').update({balance:'999999'}).eq('league_id',leagueId)).error?.code).toBe('42501')
    state.client=client(own.token);await expect(acceptBet(first,crypto.randomUUID())).rejects.toMatchObject({message:expect.stringContaining('BET_SPECTATOR')})
    const bClient=client(b.token),cClient=client(c.token)
    const acceptRequest=crypto.randomUUID()
    const [accepted,competing]=await Promise.all([bClient.rpc('accept_pickle_bet',{p_bet_id:first,p_request_id:acceptRequest}),cClient.rpc('accept_pickle_bet',{p_bet_id:first,p_request_id:crypto.randomUUID()})])
    expect(accepted.error).toBeNull();expect(competing.error?.message).toContain('BET_TAKEN')
    state.client=bClient;await acceptBet(first,acceptRequest)
    expect(await fetchWallet(leagueId)).toMatchObject({reserved:'5000.000000',available:addPoints(bBalance,'-5000')})
    await expect(confirmSettlement({matchId:m.id,fingerprint:'fake',revision:0,status:'scheduled',winnerId:null,homeScore:null,awayScore:null,bets:[]})).rejects.toMatchObject({code:'42501'})
    state.client=client(api.token)
    await recordResult(m.id,{winnerTeamId:m.home_team_id,homeScore:11,awayScore:7})
    const preview=await fetchSettlementPreview(m.id)
    expect(preview.bets[0]).toMatchObject({creatorNet:'5000.000000',acceptorNet:'-5000.000000'})
    const [receipt,payRetry]=await Promise.all([confirmSettlement(preview),confirmSettlement(preview)]);expect(receipt).toBe(payRetry)
    expect((await fetchLeaguePickleLeaderboard(leagueId)).find(p=>p.id===spectators[0]!.id)?.balance).toBe(addPoints(aBalance,'5000'))
    await expect(recordResult(m.id,{winnerTeamId:m.away_team_id,homeScore:7,awayScore:11})).rejects.toMatchObject({message:expect.stringContaining('BET_CORRECTION')})
    const current=await fetchSettlementPreview(m.id)
    const correction={reason:'Wrong winner recorded',fingerprint:current.fingerprint,revision:current.revision,requestId:crypto.randomUUID()}
    await recordResult(m.id,{winnerTeamId:m.away_team_id,homeScore:7,awayScore:11},correction)
    await recordResult(m.id,{winnerTeamId:m.away_team_id,homeScore:7,awayScore:11},correction)
    expect((await fetchSettlementPreview(m.id)).revision).toBe(2)
    state.client=client(a.token)
    expect(await fetchWallet(leagueId)).toMatchObject({balance:addPoints(aBalance,'-1000'),reserved:'0',available:addPoints(aBalance,'-1000')})
    expect((await fetchWalletHistory(leagueId)).filter(t=>t.kind==='reversal')).toHaveLength(1)
    const next=matches.find(match=>match.id!==m.id && ![...match.home_pool_player_ids!,...match.away_pool_player_ids!].some(id=>[spectators[0]!.id,spectators[1]!.id].includes(id)))!
    const offer=await createBet(next.id,next.home_team_id,'2000','3000',crypto.randomUUID());await cancelBet(offer)
    expect((await fetchBets(leagueId)).find(bet=>bet.id===offer)?.state).toBe('cancelled')
    const refunded=await createBet(next.id,next.home_team_id,'2000','3000',crypto.randomUUID())
    state.client=client(b.token);await acceptBet(refunded,crypto.randomUUID())
    state.client=client(api.token);await recordForfeit(next.id,next.away_team_id,next.home_team_id,next.away_team_id)
    await confirmSettlement(await fetchSettlementPreview(next.id))
    expect((await fetchBets(leagueId)).find(bet=>bet.id===refunded)?.state).toBe('refunded')
    state.client=client();await expect(fetchBets(leagueId)).rejects.toMatchObject({code:'42501'})
    expect(await fetchLeaguePickleLeaderboard(leagueId)).toHaveLength(14)
  },20000)
  it('migrates existing immutable awards into wallets without rewriting them',async()=>{
    const old=await startLocalSupabase({beforeMigration:'20261012160242_pickle_match_bets.sql'})
    try {
      state.client=createClient(old.url,'local-anon-key',{global:{headers:{Authorization:`Bearer ${old.token}`}},auth:{persistSession:false,autoRefreshToken:false}})
      const {leagueId,seasonId,players}=old.seeded!
      await setSeasonFormat(seasonId,'team_duel')
      const draft=await fetchLeagueDuelDraftPreview(leagueId,seasonId,players.map(p=>p.id))
      await saveLeagueDuelDraft(seasonId,draft.drafts[0]!,['Historic green','Historic blue'],draft.revision,draft.fingerprint)
      await createSeasonMatches(seasonId)
      await old.db.query("UPDATE public.matches SET status='forfeit',winner_team_id=home_team_id WHERE season_id=$1",[seasonId])
      await savePickleSettings('season',seasonId,{matchPrize:'21000',championPrize:'0'})
      await archiveWithPicklePoints(seasonId,(await fetchPicklePreview(seasonId)).fingerprint)
      const before=await fetchLeaguePickleLeaderboard(leagueId)
      const receipt=(await old.db.query('SELECT receipt FROM public.pickle_awards WHERE season_id=$1',[seasonId])).rows[0]
      await old.db.exec(await readFile('supabase/migrations/20261012160242_pickle_match_bets.sql','utf8'))
      expect(await fetchLeaguePickleLeaderboard(leagueId)).toEqual(before)
      expect((await old.db.query('SELECT receipt FROM public.pickle_awards WHERE season_id=$1',[seasonId])).rows[0]).toEqual(receipt)
      expect((await old.db.query<{count:number}>('SELECT count(*) AS count FROM public.pickle_transactions')).rows[0]?.count).toBe(14)
      expect((await old.db.query<{role:string}>('SELECT raw_app_meta_data->>\'role\' AS role FROM auth.users')).rows[0]?.role).toBe('admin')
    } finally {await old.close();state.client=client(api.token)}
  },20000)
})
