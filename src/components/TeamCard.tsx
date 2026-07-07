import type { TeamWithPlayers } from '../types'

interface TeamCardProps {
  team: TeamWithPlayers
}

export function TeamCard({ team }: TeamCardProps) {
  return (
    <div className="rounded-xl border border-green-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <span
          className="inline-block h-4 w-4 rounded-full"
          style={{ backgroundColor: team.color }}
        />
        <h3 className="text-lg font-semibold text-gray-900">{team.name}</h3>
      </div>
      <ul className="space-y-2">
        {team.players.map((player) => (
          <li
            key={player.id}
            className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-gray-700"
          >
            <span className="text-green-600">●</span>
            {player.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
