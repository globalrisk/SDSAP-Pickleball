import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchActiveSeason, fetchSeasons } from '../lib/api'
import type { Season } from '../types'

const STORAGE_KEY = 'sdsap-selected-season-id'

interface SeasonContextValue {
  seasons: Season[]
  selectedSeason: Season | null
  activeSeason: Season | null
  isLoading: boolean
  isError: boolean
  error: Error | null
  setSelectedSeasonId: (seasonId: string) => void
  isSelectedSeasonActive: boolean
}

const SeasonContext = createContext<SeasonContextValue | null>(null)

export function SeasonProvider({ children }: { children: ReactNode }) {
  const seasonsQuery = useQuery({
    queryKey: ['seasons'],
    queryFn: fetchSeasons,
  })

  const activeSeasonQuery = useQuery({
    queryKey: ['seasons', 'active'],
    queryFn: fetchActiveSeason,
  })

  const seasons = seasonsQuery.data ?? []
  const activeSeason = activeSeasonQuery.data ?? null

  const [selectedSeasonId, setSelectedSeasonIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(STORAGE_KEY)
  })

  useEffect(() => {
    if (seasons.length === 0) return

    const stored = selectedSeasonId
      ? seasons.find((s) => s.id === selectedSeasonId)
      : null

    if (stored) return

    const fallback = activeSeason ?? seasons[0]
    if (fallback) {
      setSelectedSeasonIdState(fallback.id)
      localStorage.setItem(STORAGE_KEY, fallback.id)
    }
  }, [seasons, selectedSeasonId, activeSeason])

  const setSelectedSeasonId = useCallback((seasonId: string) => {
    setSelectedSeasonIdState(seasonId)
    localStorage.setItem(STORAGE_KEY, seasonId)
  }, [])

  const selectedSeason = useMemo(
    () => seasons.find((s) => s.id === selectedSeasonId) ?? activeSeason ?? seasons[0] ?? null,
    [seasons, selectedSeasonId, activeSeason],
  )

  const value = useMemo(
    (): SeasonContextValue => ({
      seasons,
      selectedSeason,
      activeSeason,
      isLoading: seasonsQuery.isLoading || activeSeasonQuery.isLoading,
      isError: seasonsQuery.isError || activeSeasonQuery.isError,
      error: (seasonsQuery.error ?? activeSeasonQuery.error) as Error | null,
      setSelectedSeasonId,
      isSelectedSeasonActive: selectedSeason?.status === 'active',
    }),
    [
      seasons,
      selectedSeason,
      activeSeason,
      seasonsQuery.isLoading,
      activeSeasonQuery.isLoading,
      seasonsQuery.isError,
      activeSeasonQuery.isError,
      seasonsQuery.error,
      activeSeasonQuery.error,
      setSelectedSeasonId,
    ],
  )

  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>
}

export function useSeason() {
  const context = useContext(SeasonContext)
  if (!context) {
    throw new Error('useSeason must be used within SeasonProvider')
  }
  return context
}
