/** Short date for match / profile labels (locale-aware). */
export function formatMatchDate(
  iso: string | null | undefined,
  language: string,
): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  const locale = language.startsWith('vi') ? 'vi-VN' : 'en-GB'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}
