import { useEffect, useId } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchLeaguePickleLeaderboard, fetchPicklePreview } from '../lib/picklePointsApi'
import { supabase } from '../lib/supabase'
import { useLeague } from '../context/LeagueContext'

export function usePicklePreview(seasonId?: string) {
  const queryClient = useQueryClient()
  const channelId = useId()
  useEffect(() => {
    if (!seasonId) return
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['pickle-preview', seasonId] }) }
    const channel = supabase.channel(`pickle-preview-${channelId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'matches', filter: `season_id=eq.${seasonId}`,
    }, refresh).on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'pickle_awards', filter: `season_id=eq.${seasonId}`,
    }, refresh).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [seasonId, channelId, queryClient])
  return useQuery({ queryKey: ['pickle-preview', seasonId], queryFn: () => fetchPicklePreview(seasonId!), enabled: !!seasonId, staleTime: 0, refetchOnWindowFocus: 'always' })
}

export function usePickleLeaderboard() {
  const { league } = useLeague()
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = supabase.channel(`league-pickle-awards-${league.id}`).on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'pickle_awards', filter: `league_id=eq.${league.id}`,
    }, () => {
      void queryClient.invalidateQueries({ queryKey: ['pickle-points'] })
      void queryClient.invalidateQueries({ queryKey: ['pickle-preview'] })
    }).on('postgres_changes', {
      event: '*', schema: 'public', table: 'pickle_bets', filter: `league_id=eq.${league.id}`,
    }, () => { void queryClient.invalidateQueries({ queryKey: ['pickle-points'] }) }).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [queryClient, league.id])
  return useQuery({ queryKey: ['pickle-points', 'league-leaderboard', league.id], queryFn: () => fetchLeaguePickleLeaderboard(league.id), refetchOnWindowFocus: 'always' })
}
