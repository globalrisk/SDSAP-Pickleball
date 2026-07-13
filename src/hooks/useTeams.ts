import { useQuery } from '@tanstack/react-query'
import { fetchTeams, fetchTeamsWithPlayers } from '../lib/api'
import { useSeason } from '../context/SeasonContext'

export function useTeams() {
  const { selectedSeason } = useSeason()
  const seasonId = selectedSeason?.id

  return useQuery({
    queryKey: ['teams', seasonId],
    queryFn: () => fetchTeams(seasonId!),
    enabled: !!seasonId,
  })
}

export function useTeamsWithPlayers() {
  const { selectedSeason } = useSeason()
  const seasonId = selectedSeason?.id

  return useQuery({
    queryKey: ['teams-with-players', seasonId],
    queryFn: () => fetchTeamsWithPlayers(seasonId!),
    enabled: !!seasonId,
  })
}
