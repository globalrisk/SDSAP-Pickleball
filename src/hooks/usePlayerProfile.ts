import { useQuery } from '@tanstack/react-query'
import { fetchPlayerProfile } from '../lib/api'
import { useLeague } from '../context/LeagueContext'

export function usePlayerProfile(poolPlayerId: string | undefined) {
  const { league } = useLeague()
  return useQuery({
    queryKey: ['player-profile', league.id, poolPlayerId],
    queryFn: () => fetchPlayerProfile(league.id, poolPlayerId!),
    enabled: Boolean(poolPlayerId),
  })
}
