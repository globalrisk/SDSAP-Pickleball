import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TournamentConnectionStatus } from './useTournamentRealtime'

export function useRotationRealtime(refreshSnapshot: () => Promise<void>) {
  const [status, setStatus] = useState<TournamentConnectionStatus>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'connecting',
  )
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)

  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void refreshSnapshot()
        .then(() => {
          if (!disposed) setLastSyncedAt(new Date())
        })
        .catch((error) => {
          if (!disposed) console.error('Rotation snapshot refresh failed', error)
        })
    }
    const handleOffline = () => setStatus('offline')
    const handleOnline = () => {
      setStatus('reconnecting')
      refresh()
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    const channel = supabase
      .channel('rotation-current-event')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rotation_events' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rotation_players' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rotation_matches' }, refresh)
      .subscribe((nextStatus, error) => {
        if (disposed) return
        if (nextStatus === 'SUBSCRIBED') {
          setStatus('connected')
          refresh()
        } else if (
          nextStatus === 'CHANNEL_ERROR' ||
          nextStatus === 'TIMED_OUT' ||
          nextStatus === 'CLOSED'
        ) {
          if (error) console.error('Rotation realtime connection failed', error)
          setStatus(navigator.onLine ? 'reconnecting' : 'offline')
        }
      })

    return () => {
      disposed = true
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      void supabase.removeChannel(channel)
    }
  }, [refreshSnapshot])

  return { status, lastSyncedAt }
}
