import type { QueryClient, QueryKey } from '@tanstack/react-query'

const privateRoots = new Set(['bets', 'player-account', 'player-account-links', 'player-account-directory', 'admin-username', 'player-skill-rating'])
export function isPrivateUserQuery(key: QueryKey, userId: string): boolean {
  return privateRoots.has(String(key[0])) && key.includes(userId)
}
export async function clearPrivateQueries(client: QueryClient, userId: string, playerId?: string) {
  const predicate = (query: { queryKey: QueryKey }) => isPrivateUserQuery(query.queryKey, userId)
    && (!playerId || (['bets', 'player-skill-rating'].includes(String(query.queryKey[0])) && query.queryKey.includes(playerId)))
  await client.cancelQueries({ predicate })
  client.removeQueries({ predicate })
}
