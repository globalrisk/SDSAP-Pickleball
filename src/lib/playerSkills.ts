export const SKILL_GROUPS = [
  { id: 'shots', skills: ['drive', 'drop', 'serve', 'dink', 'return', 'volley', 'lob', 'reset', 'overhead'] },
  { id: 'attributes', skills: ['footwork', 'hand_speed', 'stamina', 'positioning', 'shot_selection', 'game_iq', 'mental_game', 'teamwork', 'consistency'] },
] as const
export type SkillGroup = typeof SKILL_GROUPS[number]
export const PLAYER_SKILLS = [...SKILL_GROUPS[0].skills, ...SKILL_GROUPS[1].skills] as const
export type PlayerSkill = typeof PLAYER_SKILLS[number]
export type SkillScores = Record<PlayerSkill, number | null>
export interface SkillSummary {
  skills: Record<PlayerSkill, { average: number | null; count: number }>
  raterCount: number
  groupRaterCounts: Record<SkillGroup['id'], number>
}
export type SkillEligibility = 'eligible' | 'unlinked' | 'self' | 'league_inactive' | 'not_member' | 'inactive'
export interface MySkillRating {
  canRate: boolean
  reason: SkillEligibility
  scores: SkillScores | null
}
export type SkillDraft = Record<PlayerSkill, string>

export function skillDraft(scores: SkillScores | null): SkillDraft {
  return Object.fromEntries(PLAYER_SKILLS.map(skill => [skill, scores?.[skill] == null ? '' : String(scores[skill])])) as SkillDraft
}

/** Empty fields are unobserved, including when replacing a previous score. */
export function parseSkillDraft(draft: SkillDraft): SkillScores | null {
  const scores = {} as SkillScores
  let observed = false
  for (const skill of PLAYER_SKILLS) {
    const value = draft[skill].trim()
    if (!value) { scores[skill] = null; continue }
    if (!/^\d+$/.test(value) || Number(value) > 100) return null
    scores[skill] = Number(value)
    observed = true
  }
  return observed ? scores : null
}

export function radarPoint(index: number, score: number, axisCount: number, radius = 112): [number, number] {
  const angle = index * 2 * Math.PI / axisCount - Math.PI / 2
  return [200 + Math.cos(angle) * radius * score / 100, 200 + Math.sin(angle) * radius * score / 100]
}
