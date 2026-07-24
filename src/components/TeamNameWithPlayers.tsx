import { Link } from 'react-router-dom'

export interface TeamPlayerLink {
  name: string
  poolPlayerId?: string
}

function PlayerLabel({ player }: { player: TeamPlayerLink }) {
  if (!player.poolPlayerId) {
    return <span>{player.name}</span>
  }

  return (
    <Link
      to={`/players/${player.poolPlayerId}`}
      className="text-green-700 underline-offset-2 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {player.name}
    </Link>
  )
}

export function TeamNameWithPlayers({
  name,
  color,
  playerNames,
  players,
  alignEnd = false,
}: {
  name: string
  color: string
  /** @deprecated Prefer `players` when profile links are needed */
  playerNames?: string[]
  players?: TeamPlayerLink[]
  alignEnd?: boolean
}) {
  const linkedPlayers: TeamPlayerLink[] =
    players ?? (playerNames ?? []).map((playerName) => ({ name: playerName }))

  return (
    <div className={`min-w-0 ${alignEnd ? 'sm:text-right' : ''}`}>
      <div className={`flex items-center gap-2 ${alignEnd ? 'sm:justify-end' : ''}`}>
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate font-medium text-gray-900">{name}</span>
      </div>
      {linkedPlayers.length > 0 && (
        <p
          className={`mt-0.5 truncate text-xs text-gray-500 ${alignEnd ? 'sm:text-right' : 'pl-5'}`}
        >
          {linkedPlayers.map((player, index) => (
            <span key={`${player.name}-${index}`}>
              {index > 0 ? ' · ' : null}
              <PlayerLabel player={player} />
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
