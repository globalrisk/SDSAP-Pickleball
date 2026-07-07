import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './App'
import { Dashboard } from './pages/Dashboard'
import { StandingsPage } from './pages/Standings'
import { MatchesPage } from './pages/Matches'
import { TeamsPage } from './pages/Teams'
import { SetupPage } from './pages/Setup'
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
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="matches" element={<MatchesPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="setup" element={<SetupPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
