import { useQuery } from '@tanstack/react-query'
import { fetchPlayerRankings } from '../lib/api'
import { useLeague } from '../context/LeagueContext'

export function usePlayerRankings() {
  const { league } = useLeague()
  return useQuery({
    queryKey: ['player-rankings', league.id],
    queryFn: () => fetchPlayerRankings(league.id),
  })
}
