import type { PGlite } from '@electric-sql/pglite'

export function createTestDatabase(options?: { beforeMigration?: string }): Promise<PGlite>
