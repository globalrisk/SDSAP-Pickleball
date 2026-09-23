import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router-dom'
import { ErrorState, LoadingState } from '../components/Layout'
import { fetchLeagues } from '../lib/leagueApi'
import type { League } from '../types'

interface LeagueContextValue {
  leagues: League[]
  league: League
  leaguePath: (path?: string) => string
}

const LeagueContext = createContext<LeagueContextValue | null>(null)

export function LeagueProvider({ children }: { children: ReactNode }) {
  const { leagueSlug } = useParams<{ leagueSlug: string }>()
  const leaguesQuery = useQuery({ queryKey: ['leagues'], queryFn: fetchLeagues })

  if (leaguesQuery.isLoading) return <LoadingState />
  if (leaguesQuery.error) {
    return <ErrorState message={(leaguesQuery.error as Error).message} />
  }

  const leagues = leaguesQuery.data ?? []
  const league = leagues.find((candidate) => candidate.slug === leagueSlug)
  if (!league) {
    const fallback = leagues.find((candidate) => candidate.is_default) ?? leagues[0]
    return fallback ? <Navigate to={`/leagues/${fallback.slug}`} replace /> : null
  }

  return <ResolvedLeagueProvider leagues={leagues} league={league}>{children}</ResolvedLeagueProvider>
}

function ResolvedLeagueProvider({
  leagues,
  league,
  children,
}: {
  leagues: League[]
  league: League
  children: ReactNode
}) {
  const value = useMemo<LeagueContextValue>(() => ({
    leagues,
    league,
    leaguePath: (path = '') => {
      const suffix = path.startsWith('/') ? path : `/${path}`
      return `/leagues/${league.slug}${path ? suffix : ''}`
    },
  }), [leagues, league])

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>
}

export function DefaultLeagueRedirect({ path = '' }: { path?: string }) {
  const leaguesQuery = useQuery({ queryKey: ['leagues'], queryFn: fetchLeagues })
  if (leaguesQuery.isLoading) return <LoadingState />
  if (leaguesQuery.error) return <ErrorState message={(leaguesQuery.error as Error).message} />
  const leagues = leaguesQuery.data ?? []
  const fallback = leagues.find((league) => league.is_default) ?? leagues[0]
  return fallback ? <Navigate to={`/leagues/${fallback.slug}${path}`} replace /> : null
}

export function useLeague() {
  const context = useContext(LeagueContext)
  if (!context) throw new Error('useLeague must be used within LeagueProvider')
  return context
}
