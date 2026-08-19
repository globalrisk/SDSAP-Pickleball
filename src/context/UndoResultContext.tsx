import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { revertMatchToScheduled } from '../lib/api'
import { UndoResultContext, type UndoOffer } from './undoResult'

export function UndoResultProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [offer, setOffer] = useState<UndoOffer | null>(null)

  const undoMutation = useMutation({
    mutationFn: (matchId: string) => revertMatchToScheduled(matchId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['matches'] }),
        queryClient.invalidateQueries({ queryKey: ['standings'] }),
        queryClient.invalidateQueries({ queryKey: ['player-rankings'] }),
        queryClient.invalidateQueries({ queryKey: ['player-pool'] }),
        queryClient.invalidateQueries({ queryKey: ['player-profile'] }),
      ])
      setOffer(null)
    },
  })

  useEffect(() => {
    if (!offer) return
    const timer = window.setTimeout(() => setOffer(null), 8_000)
    return () => window.clearTimeout(timer)
  }, [offer])

  const offerUndo = useCallback((nextOffer: UndoOffer) => {
    undoMutation.reset()
    setOffer(nextOffer)
  }, [undoMutation])

  const value = useMemo(() => ({ offerUndo }), [offerUndo])

  return (
    <UndoResultContext.Provider value={value}>
      {children}
      {offer ? (
        <div
          className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-green-950 px-4 py-3 text-white shadow-xl md:bottom-6"
          role={undoMutation.isError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <p className="min-w-0 flex-1 text-sm font-medium">
            {undoMutation.isError ? t('record.undoFailed') : offer.message}
          </p>
          {undoMutation.isError ? (
            <button
              type="button"
              className="min-h-10 shrink-0 rounded-lg px-3 text-sm font-bold text-green-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={() => setOffer(null)}
            >
              {t('common.close')}
            </button>
          ) : (
            <button
              type="button"
              disabled={undoMutation.isPending}
              className="min-h-10 shrink-0 rounded-lg bg-white px-3 text-sm font-bold text-green-900 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
              onClick={() => undoMutation.mutate(offer.matchId)}
            >
              {undoMutation.isPending ? t('record.undoing') : t('common.undo')}
            </button>
          )}
        </div>
      ) : null}
    </UndoResultContext.Provider>
  )
}
