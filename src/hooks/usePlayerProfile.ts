import { useQuery } from '@tanstack/react-query'
import { fetchPlayerProfile } from '../lib/api'

export function usePlayerProfile(poolPlayerId: string | undefined) {
  return useQuery({
    queryKey: ['player-profile', poolPlayerId],
    queryFn: () => fetchPlayerProfile(poolPlayerId!),
    enabled: Boolean(poolPlayerId),
  })
}
