import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom'
import { AppLayout } from './App'
import { AuthProvider } from './context/AuthContext'
import { DefaultLeagueRedirect, LeagueProvider } from './context/LeagueContext'
import { SeasonProvider } from './context/SeasonContext'
import { UndoResultProvider } from './context/UndoResultContext'
import { Dashboard } from './pages/Dashboard'
import { StandingsPage } from './pages/Standings'
import { MatchesPage } from './pages/Matches'
import { RankingsPage } from './pages/Rankings'
import { PlayerProfilePage } from './pages/PlayerProfile'
import { SeasonRecapPage } from './pages/SeasonRecap'
import { SetupPage } from './pages/Setup'
import { LiveTournamentPage } from './pages/LiveTournament'
import { MatchPlannerPage } from './pages/MatchPlanner'
import { AdminLoginPage } from './pages/AdminLogin'
import { CreateLeaguePage } from './pages/CreateLeague'
import { AdminRoute } from './components/AdminRoute'
import './i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function LeagueShell() {
  return (
    <LeagueProvider>
      <SeasonProvider>
        <UndoResultProvider>
          <Outlet />
        </UndoResultProvider>
      </SeasonProvider>
    </LeagueProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<DefaultLeagueRedirect />} />
            <Route path="leagues/:leagueSlug" element={<LeagueShell />}>
              <Route element={<AppLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="live" element={<LiveTournamentPage />} />
                <Route path="standings" element={<StandingsPage />} />
                <Route path="matches" element={<MatchesPage />} />
                <Route path="rankings" element={<RankingsPage />} />
                <Route path="players/:playerId" element={<PlayerProfilePage />} />
                <Route path="seasons/:seasonId/recap" element={<SeasonRecapPage />} />
                <Route path="login" element={<AdminLoginPage />} />
                <Route path="setup" element={<AdminRoute><SetupPage /></AdminRoute>} />
                <Route path="admin/leagues/new" element={<AdminRoute><CreateLeaguePage /></AdminRoute>} />
              </Route>
              <Route path="match-planner" element={<MatchPlannerPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
