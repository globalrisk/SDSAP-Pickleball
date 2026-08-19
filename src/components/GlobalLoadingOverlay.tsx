import { useEffect, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

export function GlobalLoadingOverlay() {
  const { t } = useTranslation()
  const isFetching = useIsFetching()
  const [visible, setVisible] = useState(false)

  const active = isFetching > 0

  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }

    const timer = setTimeout(() => setVisible(true), 350)
    return () => clearTimeout(timer)
  }, [active])

  if (!visible) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="h-1 w-full overflow-hidden bg-green-100">
        <div className="h-full w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-green-600" />
      </div>
      <span className="sr-only">{t('common.refreshing')}</span>
    </div>
  )
}
