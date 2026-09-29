import { useQuery } from '@tanstack/react-query'
import { fetchMatches } from '../lib/api'
import { useSeason } from '../context/SeasonContext'
import { useLeague } from '../context/LeagueContext'

export function useMatches(seasonIdOverride?: string) {
  const { league } = useLeague()
  const { selectedSeason } = useSeason()
  const seasonId = seasonIdOverride ?? selectedSeason?.id

  return useQuery({
    queryKey: ['matches', seasonId, league.id],
    queryFn: () => fetchMatches(seasonId!, league.id),
    enabled: !!seasonId,
  })
}
