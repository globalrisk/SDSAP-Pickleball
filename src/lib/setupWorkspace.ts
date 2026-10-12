export const seasonSetupSections = ['overview', 'roster', 'teams', 'prizes', 'finish'] as const
export const leagueSetupSections = ['members', 'accounts', 'settings'] as const
export type SetupSection = (typeof seasonSetupSections)[number] | (typeof leagueSetupSections)[number]

/** Keep previously shared setup URLs working after reorganizing the workspace. */
export function resolveSetupSection(value: string | null): SetupSection {
  if (value === 'players') return 'members'
  if (value === 'season') return 'roster'
  if (value === 'league') return 'settings'
  const sections: readonly string[] = [...seasonSetupSections, ...leagueSetupSections]
  return value && sections.includes(value) ? value as SetupSection : 'overview'
}
