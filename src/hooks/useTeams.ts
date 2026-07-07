import { useQuery } from '@tanstack/react-query'
import { fetchTeams, fetchTeamsWithPlayers } from '../lib/api'

export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: fetchTeams,
  })
}

export function useTeamsWithPlayers() {
  return useQuery({
    queryKey: ['teams-with-players'],
    queryFn: fetchTeamsWithPlayers,
  })
}
