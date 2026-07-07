import { useEffect, useState } from 'react'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

export function GlobalLoadingOverlay() {
  const { t } = useTranslation()
  const isMutating = useIsMutating()
  const isFetching = useIsFetching()
  const [visible, setVisible] = useState(false)

  const active = isMutating > 0 || isFetching > 0

  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }

    const timer = setTimeout(() => setVisible(true), 120)
    return () => clearTimeout(timer)
  }, [active])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-950/25 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="mx-4 flex flex-col items-center gap-4 rounded-2xl border border-green-200 bg-white px-8 py-7 shadow-lg">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-green-200 border-t-green-600" />
        <p className="text-sm font-medium text-green-900">{t('common.loading')}</p>
      </div>
    </div>
  )
}
