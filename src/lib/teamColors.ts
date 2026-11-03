export const DEFAULT_TEAM_COLORS: [string, string] = ['#2563eb', '#ea580c']

export function isTeamColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color)
}
