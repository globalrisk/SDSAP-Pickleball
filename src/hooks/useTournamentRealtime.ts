import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useTournamentRealtime(seasonId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!seasonId) return

    const channel = supabase
      .channel(`tournament-${seasonId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'seasons',
          filter: `id=eq.${seasonId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['seasons'] })
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `season_id=eq.${seasonId}`,
        },
        () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['matches', seasonId] }),
            queryClient.invalidateQueries({ queryKey: ['player-rankings'] }),
            queryClient.invalidateQueries({ queryKey: ['player-pool'] }),
            queryClient.invalidateQueries({ queryKey: ['player-profile'] }),
          ])
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'players',
          filter: `season_id=eq.${seasonId}`,
        },
        () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['teams-with-players', seasonId] }),
            queryClient.invalidateQueries({ queryKey: ['matches', seasonId] }),
          ])
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, seasonId])
}
