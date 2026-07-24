import { useTranslation } from 'react-i18next'
import type { PlayerTitle } from '../types'

interface PlayerTitleBadgeProps {
  title: PlayerTitle
  size?: 'sm' | 'md'
  showWhy?: boolean
}

export function PlayerTitleBadge({
  title,
  size = 'sm',
  showWhy = false,
}: PlayerTitleBadgeProps) {
  const { t } = useTranslation()
  const name = t(`titles.${title.id}.name`)
  const why = t(`titles.${title.id}.why`, title.whyParams)

  return (
    <div className={size === 'md' ? 'mt-2' : 'mt-0.5'}>
      <span
        className={`inline-flex items-center rounded-full bg-amber-100 font-semibold text-amber-900 ${
          size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'
        }`}
        title={why}
      >
        {name}
      </span>
      {showWhy ? <p className="mt-1 text-xs text-gray-600">{why}</p> : null}
    </div>
  )
}
