import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export type TournamentConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'offline'

export function useTournamentRealtime(seasonId: string | undefined) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<TournamentConnectionStatus>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connecting',
  )
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!seasonId) {
      setStatus(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? 'offline'
          : 'connecting',
      )
      return
    }

    let disposed = false

    const refreshTournamentData = async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['seasons'] }),
        queryClient.invalidateQueries({ queryKey: ['matches', seasonId] }),
        queryClient.invalidateQueries({ queryKey: ['teams-with-players', seasonId] }),
        queryClient.invalidateQueries({ queryKey: ['player-rankings'] }),
        queryClient.invalidateQueries({ queryKey: ['player-pool'] }),
        queryClient.invalidateQueries({ queryKey: ['player-profile'] }),
      ])
      if (!disposed) setLastSyncedAt(new Date())
    }

    const refreshAfterChange = (queryKeys: readonly (readonly unknown[])[]) => {
      void Promise.all(
        queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ).then(() => {
        if (!disposed) setLastSyncedAt(new Date())
      })
    }

    const handleOffline = () => setStatus('offline')
    const handleOnline = () => {
      setStatus('reconnecting')
      void refreshTournamentData()
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    setStatus(navigator.onLine ? 'connecting' : 'offline')

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
          refreshAfterChange([['seasons']])
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
          refreshAfterChange([
            ['matches', seasonId],
            ['player-rankings'],
            ['player-pool'],
            ['player-profile'],
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
          refreshAfterChange([
            ['teams-with-players', seasonId],
            ['matches', seasonId],
          ])
        },
      )
      .subscribe((nextStatus, error) => {
        if (disposed) return
        if (nextStatus === 'SUBSCRIBED') {
          setStatus('connected')
          void refreshTournamentData()
          return
        }
        if (
          nextStatus === 'CHANNEL_ERROR' ||
          nextStatus === 'TIMED_OUT' ||
          nextStatus === 'CLOSED'
        ) {
          if (error) console.error('Tournament realtime connection failed', error)
          setStatus(navigator.onLine ? 'reconnecting' : 'offline')
        }
      })

    return () => {
      disposed = true
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      void supabase.removeChannel(channel)
    }
  }, [queryClient, seasonId])

  return { status, lastSyncedAt }
}
