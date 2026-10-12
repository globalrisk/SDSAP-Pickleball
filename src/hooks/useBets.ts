import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { fetchBets, fetchMyPlayerAccount, fetchWallet, fetchWalletHistory } from '../lib/betsApi'
import { supabase } from '../lib/supabase'

export function useMyPlayerAccount() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['player-account', user?.id], queryFn: fetchMyPlayerAccount, enabled: !!user, refetchOnWindowFocus: 'always', refetchInterval: 30_000 })
}
export function useBetData({ includeHistory = true }: { includeHistory?: boolean } = {}) {
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
  const bets = useQuery({ queryKey: ['bets', 'list', league.id, user?.id, account.data?.playerId], queryFn: () => fetchBets(league.id), enabled: !!account.data || isAdmin, refetchOnWindowFocus: 'always' })
  const history = useQuery({ queryKey: ['bets', 'history', league.id, user?.id, account.data?.playerId], queryFn: () => fetchWalletHistory(league.id), enabled: includeHistory && !!account.data, refetchOnWindowFocus: 'always' })
  return { account, wallet, bets, history }
}
