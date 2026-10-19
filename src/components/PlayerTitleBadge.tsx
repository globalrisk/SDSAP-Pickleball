import type { PlayerTitle } from '../types'

interface PlayerTitleBadgeProps {
  title: PlayerTitle
  size?: 'sm' | 'md'
}

export function PlayerTitleBadge({
  title,
  size = 'sm',
}: PlayerTitleBadgeProps) {
  return (
    <div className={size === 'md' ? 'mt-2' : 'mt-0.5'}>
      <span
        className={`inline-flex max-w-full items-center break-words rounded-full bg-amber-100 font-semibold text-amber-900 [overflow-wrap:anywhere] ${
          size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'
        }`}
      >
        {title.label}
      </span>
    </div>
  )
}
