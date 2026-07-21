function formatPlayerNames(names: string[]): string {
  return names.join(' · ')
}

export function TeamNameWithPlayers({
  name,
  color,
  playerNames,
  alignEnd = false,
}: {
  name: string
  color: string
  playerNames: string[]
  alignEnd?: boolean
}) {
  const players = formatPlayerNames(playerNames)

  return (
    <div className={`min-w-0 ${alignEnd ? 'sm:text-right' : ''}`}>
      <div className={`flex items-center gap-2 ${alignEnd ? 'sm:justify-end' : ''}`}>
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate font-medium text-gray-900">{name}</span>
      </div>
      {players && (
        <p
          className={`mt-0.5 truncate text-xs text-gray-500 ${alignEnd ? 'sm:text-right' : 'pl-5'}`}
        >
          {players}
        </p>
      )}
    </div>
  )
}
