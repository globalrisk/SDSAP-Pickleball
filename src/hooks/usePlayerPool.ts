import { useQuery } from '@tanstack/react-query'
import { fetchAssignedPoolPlayerIds, fetchPlayerPool } from '../lib/api'
import { useSeason } from '../context/SeasonContext'

export function usePlayerPool() {
  return useQuery({
    queryKey: ['player-pool'],
    queryFn: fetchPlayerPool,
  })
}

export function useAssignedPoolPlayerIds() {
  const { selectedSeason } = useSeason()
  const seasonId = selectedSeason?.id

  return useQuery({
    queryKey: ['assigned-pool-players', seasonId],
    queryFn: () => fetchAssignedPoolPlayerIds(seasonId!),
    enabled: !!seasonId,
  })
}
