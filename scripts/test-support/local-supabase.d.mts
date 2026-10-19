import type { PGlite } from '@electric-sql/pglite'
export function startLocalSupabase(options?: { port?: number; seed?: boolean; beforeMigration?: string }): Promise<{
  db: PGlite; url: string; token: string;
  seeded: { leagueId: string; seasonId: string; players: { id: string; name: string; initial_rating: number }[] } | null;
  calls: { name: string; args: Record<string, unknown> }[];
  addAccount(options: { email: string; password?: string; id?: string; role?: string }): Promise<{ id: string; token: string; email: string; password: string }>;
  conflictOnNextSave(): void; failNextSkillSave(): void; close(): Promise<void>;
}>
