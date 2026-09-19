import { useQuery } from '@tanstack/react-query'
import { fetchSeasonRecap } from '../lib/api'
import { useLeague } from '../context/LeagueContext'

export function useSeasonRecap(seasonId: string | undefined) {
  const { league } = useLeague()
  return useQuery({
    queryKey: ['season-recap', league.id, seasonId],
    queryFn: () => fetchSeasonRecap(seasonId!, league.id),
    enabled: Boolean(seasonId),
  })
}
