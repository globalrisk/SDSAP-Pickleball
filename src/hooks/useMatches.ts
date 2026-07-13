import { useQuery } from '@tanstack/react-query'
import { fetchMatches } from '../lib/api'
import { useSeason } from '../context/SeasonContext'

export function useMatches() {
  const { selectedSeason } = useSeason()
  const seasonId = selectedSeason?.id

  return useQuery({
    queryKey: ['matches', seasonId],
    queryFn: () => fetchMatches(seasonId!),
    enabled: !!seasonId,
  })
}
