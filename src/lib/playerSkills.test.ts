import { describe, expect, it } from 'vitest'
import { PLAYER_SKILLS, SKILL_GROUPS, parseSkillDraft, radarPoint, skillDraft } from './playerSkills'

describe('Optional skill scores', () => {
  it('keeps skipped skills distinct from zero and accepts both boundaries', () => {
    const draft = { ...skillDraft(null), drive: '0', serve: '100' }
    const scores = parseSkillDraft(draft)!
    expect(scores.drive).toBe(0)
    expect(scores.serve).toBe(100)
    expect(scores.drop).toBeNull()
    expect(skillDraft(scores)).toEqual(draft)
  })
  it('requires a score and rejects invalid or fractional entries', () => {
    expect(parseSkillDraft(skillDraft(null))).toBeNull()
    for (const drive of ['-1', '101', '99.5', '1e2', 'NaN', 'Infinity']) {
      expect(parseSkillDraft({ ...skillDraft(null), drive })).toBeNull()
    }
  })
  it('places zero at the center and 100 on the correct outer spoke', () => {
    expect(radarPoint(0, 0, 9)).toEqual([200, 200])
    expect(radarPoint(0, 100, 9)).toEqual([200, 88])
    expect(radarPoint(2, 100, 8)).toEqual([312, 200])
    const points = Array.from({ length: 9 }, (_, i) => radarPoint(i, 100, 9))
    expect(new Set(points.map(point => point.join(','))).size).toBe(9)
    expect(radarPoint(9, 100, 9)[0]).toBeCloseTo(points[0]![0])
    expect(radarPoint(9, 100, 9)[1]).toBeCloseTo(points[0]![1])
  })
  it('has eighteen unique attributes in two groups and preserves footwork as a game attribute', () => {
    expect(PLAYER_SKILLS).toHaveLength(18)
    expect(new Set(PLAYER_SKILLS).size).toBe(18)
    expect(SKILL_GROUPS.map(group => group.skills.length)).toEqual([9, 9])
    expect(SKILL_GROUPS[1].skills).toContain('footwork')
    for (const skill of PLAYER_SKILLS) {
      expect(parseSkillDraft({ ...skillDraft(null), [skill]: '0' })?.[skill]).toBe(0)
      expect(parseSkillDraft({ ...skillDraft(null), [skill]: '100.5' })).toBeNull()
    }
  })
})
