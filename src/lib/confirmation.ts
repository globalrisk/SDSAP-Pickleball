import { createContext, useContext } from 'react'

export interface ConfirmationOptions {
  title?: string
  confirmLabel?: string
  tone?: 'default' | 'danger'
}

export type ConfirmAction = (message: string, options?: ConfirmationOptions) => Promise<boolean>
export const ConfirmationContext = createContext<ConfirmAction | null>(null)

export function useConfirm(): ConfirmAction {
  const confirm = useContext(ConfirmationContext)
  if (!confirm) throw new Error('useConfirm requires ConfirmationProvider')
  return confirm
}
