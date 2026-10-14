import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { LoadingState } from './Layout'

export function SignedInRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  const { leaguePath } = useLeague()
  const location = useLocation()
  if (isLoading) return <LoadingState />
  if (!user) return <Navigate to={`${leaguePath('/login')}?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return children
}
