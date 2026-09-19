import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { LoadingState } from './Layout'

export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading } = useAuth()
  const { leaguePath } = useLeague()
  if (isLoading) return <LoadingState />
  if (!isAdmin) return <Navigate to={leaguePath('/login')} replace />
  return children
}
