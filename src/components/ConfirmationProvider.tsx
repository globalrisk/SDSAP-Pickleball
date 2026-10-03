import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { ConfirmationContext, type ConfirmationOptions } from '../lib/confirmation'

interface ConfirmationRequest extends ConfirmationOptions {
  message: string
  resolve: (confirmed: boolean) => void
  trigger: HTMLElement | null
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const location = useLocation()
  const [request, setRequest] = useState<ConfirmationRequest | null>(null)
  const pending = useRef<ConfirmationRequest | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  const finish = useCallback((confirmed: boolean) => {
    const current = pending.current
    if (!current) return
    pending.current = null
    setRequest(null)
    current.resolve(confirmed)
  }, [])

  const confirm = useCallback((message: string, options: ConfirmationOptions = {}) => {
    // Prevent a double click from queuing the same destructive action twice.
    if (pending.current) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const next = { ...options, message, resolve, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null }
      pending.current = next
      returnFocus.current = next.trigger
      setRequest(next)
    })
  }, [])

  useEffect(() => { finish(false) }, [location.pathname, finish])
  useEffect(() => () => {
    pending.current?.resolve(false)
    pending.current = null
  }, [])

  return <ConfirmationContext.Provider value={confirm}>
    {children}
    <AlertDialog.Root open={request !== null}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="themed-overlay fixed inset-0 z-[90] bg-green-950/45 backdrop-blur-sm" />
        <AlertDialog.Content
          onEscapeKeyDown={(event) => { event.preventDefault(); finish(false) }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus() }}
          className="themed-dialog fixed top-1/2 left-1/2 z-[100] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-green-200 bg-white p-6 shadow-2xl shadow-green-950/20 focus:outline-none sm:p-7"
        >
          <div className={`mb-4 flex size-12 items-center justify-center rounded-2xl ${request?.tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-green-100 text-green-700'}`}>
            <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v4m0 3h.01" /></svg>
          </div>
          <AlertDialog.Title className="text-xl font-bold tracking-tight text-green-950">{request?.title ?? t('common.confirmTitle')}</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 whitespace-pre-line text-sm leading-6 text-gray-600">{request?.message}</AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-green-100 pt-5 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel onClick={() => finish(false)} className="min-h-11 rounded-xl border border-green-200 bg-white px-5 py-2.5 text-sm font-bold text-green-800 transition-colors hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2">{t('common.cancel')}</AlertDialog.Cancel>
            <AlertDialog.Action onClick={() => finish(true)} className={`min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${request?.tone === 'danger' ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-600' : 'bg-green-600 hover:bg-green-700 focus-visible:ring-green-600'}`}>{request?.confirmLabel ?? t('common.confirm')}</AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </ConfirmationContext.Provider>
}
