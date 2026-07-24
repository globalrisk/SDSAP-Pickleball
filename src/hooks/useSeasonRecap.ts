import { useQuery } from '@tanstack/react-query'
import { fetchSeasonRecap } from '../lib/api'

export function useSeasonRecap(seasonId: string | undefined) {
  return useQuery({
    queryKey: ['season-recap', seasonId],
    queryFn: () => fetchSeasonRecap(seasonId!),
    enabled: Boolean(seasonId),
  })
}
