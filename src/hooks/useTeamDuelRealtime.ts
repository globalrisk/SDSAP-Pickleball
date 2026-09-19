import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TournamentConnectionStatus } from './useTournamentRealtime'

export function useTeamDuelRealtime(
  eventId: string | undefined,
  refresh: () => Promise<void>,
) {
  const [status, setStatus] = useState<TournamentConnectionStatus>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connecting',
  )

  useEffect(() => {
    let disposed = false
    const refreshSafely = () => {
      void refresh().catch((error) => {
        if (!disposed) console.error('Team Duel refresh failed', error)
      })
    }
    const handleOffline = () => setStatus('offline')
    const handleOnline = () => {
      setStatus('reconnecting')
      refreshSafely()
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    const channel = supabase
      .channel(`team-duel-${eventId ?? 'hub'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_duel_squads' }, refreshSafely)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_duel_squad_members' }, refreshSafely)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_duel_events' }, refreshSafely)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_duel_event_players',
        filter: `event_id=eq.${eventId ?? '00000000-0000-0000-0000-000000000000'}`,
      }, refreshSafely)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_duel_matches',
        filter: `event_id=eq.${eventId ?? '00000000-0000-0000-0000-000000000000'}`,
      }, refreshSafely)
      .subscribe((nextStatus, error) => {
        if (disposed) return
        if (nextStatus === 'SUBSCRIBED') {
          setStatus('connected')
          refreshSafely()
        } else if (
          nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT' || nextStatus === 'CLOSED'
        ) {
          if (error) console.error('Team Duel realtime connection failed', error)
          setStatus(navigator.onLine ? 'reconnecting' : 'offline')
        }
      })

    return () => {
      disposed = true
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      void supabase.removeChannel(channel)
    }
  }, [eventId, refresh])

  return status
}
