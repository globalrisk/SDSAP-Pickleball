import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './App'
import { SeasonProvider } from './context/SeasonContext'
import { Dashboard } from './pages/Dashboard'
import { StandingsPage } from './pages/Standings'
import { MatchesPage } from './pages/Matches'
import { RankingsPage } from './pages/Rankings'
import { PlayerProfilePage } from './pages/PlayerProfile'
import { SeasonRecapPage } from './pages/SeasonRecap'
import { SetupPage } from './pages/Setup'
import { LiveTournamentPage } from './pages/LiveTournament'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SeasonProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="live" element={<LiveTournamentPage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="matches" element={<MatchesPage />} />
            <Route path="rankings" element={<RankingsPage />} />
            <Route path="players/:playerId" element={<PlayerProfilePage />} />
            <Route path="seasons/:seasonId/recap" element={<SeasonRecapPage />} />
            <Route path="setup" element={<SetupPage />} />
          </Route>
          </Routes>
        </BrowserRouter>
      </SeasonProvider>
    </QueryClientProvider>
  </StrictMode>,
)
