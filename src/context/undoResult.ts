import { createContext, useContext } from 'react'

export interface UndoOffer {
  matchId: string
  message: string
}

export interface UndoResultContextValue {
  offerUndo: (offer: UndoOffer) => void
}

export const UndoResultContext = createContext<UndoResultContextValue | null>(null)

export function useUndoResult() {
  const context = useContext(UndoResultContext)
  if (!context) throw new Error('useUndoResult must be used within UndoResultProvider')
  return context
}
