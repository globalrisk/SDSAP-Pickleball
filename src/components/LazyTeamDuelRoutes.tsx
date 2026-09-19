import { lazy, Suspense, type ReactNode } from 'react'

const TeamDuelPage = lazy(() =>
  import('../pages/TeamDuel').then((module) => ({ default: module.TeamDuelPage })),
)
const TeamDuelLoginPage = lazy(() =>
  import('../pages/TeamDuel').then((module) => ({ default: module.TeamDuelLoginPage })),
)

function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center bg-indigo-50"><div className="size-9 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-700" /></div>}>
      {children}
    </Suspense>
  )
}

export function LazyTeamDuelPage() {
  return <LazyPage><TeamDuelPage /></LazyPage>
}

export function LazyTeamDuelLoginPage() {
  return <LazyPage><TeamDuelLoginPage /></LazyPage>
}
