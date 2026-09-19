import { useQuery } from '@tanstack/react-query'
import { fetchAssignedPoolPlayerIds, fetchPlayerPool } from '../lib/api'
import { useSeason } from '../context/SeasonContext'
import { useLeague } from '../context/LeagueContext'

export function usePlayerPool() {
  const { league } = useLeague()
  return useQuery({
    queryKey: ['player-pool', league.id],
    queryFn: () => fetchPlayerPool(league.id),
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
