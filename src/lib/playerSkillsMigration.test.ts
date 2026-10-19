import { readFile, readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createTestDatabase } from '../../scripts/test-database.mjs'
import type { SkillSummary } from './playerSkills'

it('preserves pre-expansion ratings and timestamps, including a footwork-only vote', async () => {
  const files = (await readdir('supabase/migrations')).filter(file => file.endsWith('_expand_player_attributes.sql'))
  expect(files).toHaveLength(1)
  const migration = files[0]!
  const db = await createTestDatabase({ beforeMigration: migration })
  try {
    const [target, first, second] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    await db.query('INSERT INTO public.player_pool(id,name) VALUES($1,$4),($2,$5),($3,$6)', [target, first, second, 'Migration target', 'Original rater', 'Footwork rater'])
    await db.query("INSERT INTO player_skills_private.ratings(rater_id,target_id,drive,serve,footwork,created_at,updated_at) VALUES($1,$3,0,100,86,'2026-10-19T10:00:00Z','2026-10-19T11:00:00Z'),($2,$3,NULL,NULL,0,'2026-10-19T12:00:00Z','2026-10-19T13:00:00Z')", [first, second, target])
    const selectOriginal = 'SELECT rater_id,target_id,drive,drop,serve,dink,return,volley,lob,footwork,created_at,updated_at FROM player_skills_private.ratings ORDER BY rater_id'
    const original = (await db.query(selectOriginal)).rows
    await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'))
    expect((await db.query(selectOriginal)).rows).toEqual(original)
    const result = (await db.query<{ summary: SkillSummary }>('SELECT public.player_skill_summary($1) AS summary', [target])).rows[0]!.summary
    expect(Object.keys(result.skills)).toHaveLength(18)
    expect(result.raterCount).toBe(2)
    expect(result.groupRaterCounts).toEqual({ shots: 1, attributes: 2 })
    expect(result.skills.footwork).toEqual({ average: 43, count: 2 })
    expect(result.skills.drive).toEqual({ average: 0, count: 1 })
    for (const key of ['reset', 'overhead', 'hand_speed', 'stamina', 'positioning', 'shot_selection', 'game_iq', 'mental_game', 'teamwork', 'consistency'] as const) {
      expect(result.skills[key]).toEqual({ average: null, count: 0 })
    }
  } finally { await db.close() }
}, 20000)
