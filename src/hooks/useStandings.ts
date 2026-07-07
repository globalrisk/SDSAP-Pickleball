import { useMemo } from 'react'
import { computeStandings } from '../lib/standings'
import { useMatches } from './useMatches'
import { useTeams } from './useTeams'

export function useStandings() {
  const teamsQuery = useTeams()
  const matchesQuery = useMatches()

  const standings = useMemo(() => {
    if (!teamsQuery.data || !matchesQuery.data) return []
    return computeStandings(teamsQuery.data, matchesQuery.data)
  }, [teamsQuery.data, matchesQuery.data])

  return {
    standings,
    isLoading: teamsQuery.isLoading || matchesQuery.isLoading,
    isError: teamsQuery.isError || matchesQuery.isError,
    error: teamsQuery.error ?? matchesQuery.error,
  }
}
