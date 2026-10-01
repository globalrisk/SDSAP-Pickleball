import { useMemo } from 'react'
import { computeStandings } from '../lib/standings'
import { useMatches } from './useMatches'
import { useTeamsWithPlayers } from './useTeams'
import { useSeason } from '../context/SeasonContext'

export function useStandings() {
  const { selectedSeason } = useSeason()
  const teamsQuery = useTeamsWithPlayers()
  const matchesQuery = useMatches()

  const standings = useMemo(() => {
    if (!teamsQuery.data || !matchesQuery.data) return []
    return computeStandings(teamsQuery.data, matchesQuery.data, selectedSeason?.format)
  }, [teamsQuery.data, matchesQuery.data, selectedSeason?.format])

  return {
    standings,
    isLoading: teamsQuery.isLoading || matchesQuery.isLoading,
    isError: teamsQuery.isError || matchesQuery.isError,
    error: teamsQuery.error ?? matchesQuery.error,
  }
}
