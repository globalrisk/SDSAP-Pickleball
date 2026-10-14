import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { fetchBets, fetchMyPlayerAccount, fetchWallet, fetchWalletHistory } from '../lib/betsApi'
import { supabase } from '../lib/supabase'
import { clearPrivateQueries } from '../lib/privateQueries'

export function useMyPlayerAccount() {
  const { user } = useAuth()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['player-account', user?.id], queryFn: fetchMyPlayerAccount, enabled: !!user, refetchOnWindowFocus: 'always', refetchInterval: 30_000 })
  const userId = user?.id
  const playerId = query.data?.playerId
  const previous = useRef<{ userId: string; playerId: string } | null>(null)
  useEffect(() => {
    if (!query.isSuccess || !userId) return
    const old = previous.current
    if (old && (old.userId !== userId || old.playerId !== playerId)) void clearPrivateQueries(client, old.userId, old.playerId)
    previous.current = playerId ? { userId, playerId } : null
  }, [client, userId, query.isSuccess, playerId])
  return query
}
export function useBetData({ includeHistory = true, includeBets = true }: { includeHistory?: boolean; includeBets?: boolean } = {}) {
  const { user, isAdmin } = useAuth()
  const userId = user?.id
  const { league } = useLeague()
  const account = useMyPlayerAccount()
  const client = useQueryClient()
  useEffect(() => {
    if (!userId) return
    const refresh = () => { void client.invalidateQueries({ queryKey: ['bets'] }); void client.invalidateQueries({ queryKey: ['pickle-points'] }) }
    let channel = supabase.channel(`bets-${league.id}-${userId}-${crypto.randomUUID()}`)
    for (const table of ['pickle_bets', 'pickle_wallets', 'pickle_transactions', 'pickle_bet_settlements', 'pickle_awards']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `league_id=eq.${league.id}` }, refresh)
    }
    channel.subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [client, league.id, userId])
  const wallet = useQuery({ queryKey: ['bets', 'wallet', league.id, user?.id, account.data?.playerId], queryFn: () => fetchWallet(league.id), enabled: !!account.data, refetchOnWindowFocus: 'always' })
  const bets = useQuery({ queryKey: ['bets', 'list', league.id, user?.id, account.data?.playerId], queryFn: () => fetchBets(league.id), enabled: includeBets && (!!account.data || isAdmin), refetchOnWindowFocus: 'always' })
  const history = useQuery({ queryKey: ['bets', 'history', league.id, user?.id, account.data?.playerId], queryFn: () => fetchWalletHistory(league.id), enabled: includeHistory && !!account.data, refetchOnWindowFocus: 'always' })
  return { account, wallet, bets, history }
}
