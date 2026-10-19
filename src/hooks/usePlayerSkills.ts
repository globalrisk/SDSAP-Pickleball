import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { useMyPlayerAccount } from './useBets'
import { fetchMySkillRating, fetchSkillSummary } from '../lib/playerSkillsApi'

export function usePlayerSkills(playerId: string) {
  const { user, isLoading: authLoading } = useAuth()
  const { league } = useLeague()
  const account = useMyPlayerAccount()
  const summary = useQuery({
    queryKey: ['player-skills', playerId],
    queryFn: ({ signal }) => fetchSkillSummary(playerId, signal),
    refetchOnWindowFocus: 'always',
  })
  const mine = useQuery({
    queryKey: ['player-skill-rating', user?.id, account.data?.playerId, league.id, playerId],
    queryFn: ({ signal }) => fetchMySkillRating(league.id, playerId, signal),
    enabled: !!user && account.isSuccess,
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
  })
  return { summary, mine, account, user, authLoading, leagueId: league.id }
}
