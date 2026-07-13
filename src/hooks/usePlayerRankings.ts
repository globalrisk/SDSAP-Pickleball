import { useQuery } from '@tanstack/react-query'
import { fetchPlayerRankings } from '../lib/api'

export function usePlayerRankings() {
  return useQuery({
    queryKey: ['player-rankings'],
    queryFn: fetchPlayerRankings,
  })
}
