import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_TEAM_COLORS } from '../lib/teamColors'

export function TeamColorField({ value, onChange, disabled = false }: {
  value: string; onChange: (color: string) => void; disabled?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  return <div>
    <label htmlFor={id} className="block text-sm font-semibold text-green-950">{t('teamColors.label')}</label>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input id={id} type="color" value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
        className="h-11 w-14 cursor-pointer rounded-lg border border-green-200 bg-white p-1 disabled:opacity-50" />
      <span className="mr-2 text-xs text-gray-500">{value.toUpperCase()}</span>
      {DEFAULT_TEAM_COLORS.map((color, side) => <button key={color} type="button" disabled={disabled}
        aria-pressed={value.toLowerCase() === color} onClick={() => onChange(color)}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-green-200 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-green-50 disabled:opacity-50">
        <span aria-hidden="true" className="size-3 rounded-full" style={{ backgroundColor: color }} />{t(side === 0 ? 'teamColors.blue' : 'teamColors.orange')}
      </button>)}
    </div>
  </div>
}
