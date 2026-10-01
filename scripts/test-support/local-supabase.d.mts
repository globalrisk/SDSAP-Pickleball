import type { PGlite } from '@electric-sql/pglite'
export function startLocalSupabase(options?: { port?: number; seed?: boolean }): Promise<{
  db: PGlite; url: string; token: string;
  seeded: { leagueId: string; seasonId: string; players: { id: string; name: string; initial_rating: number }[] } | null;
  calls: { name: string; args: Record<string, unknown> }[];
  conflictOnNextSave(): void; close(): Promise<void>;
}>
