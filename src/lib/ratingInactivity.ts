import {
  INACTIVITY_GRACE_DAYS,
  inactivityRatingDeviation,
  type SkillRating,
} from './ratings.ts'

const DAY_MS = 24 * 60 * 60 * 1000

/** UTC dates avoid charging weekly players for a few hours of result-entry jitter. */
function activityDay(timestamp: string | null | undefined): number | null {
  const time = timestamp ? Date.parse(timestamp) : NaN
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : null
}

/** Result entry is the available playing-time proxy; legacy rows use the season date. */
export function ratingActivityDate(match: {
  result_recorded_at: string | null
  season_starts_at: string
}): string | null {
  if (activityDay(match.result_recorded_at) !== null) return match.result_recorded_at
  return activityDay(match.season_starts_at) !== null ? match.season_starts_at : null
}

/** Replay-local state, rebuilt from results rather than persisted/incremented on retries. */
export class RatingInactivityTracker {
  private activity = new Map<string, { lastPlayedDay: number; appliedThroughDay: number }>()

  apply(ratings: Map<string, SkillRating>, timestamp: string | null): string[] {
    const day = activityDay(timestamp)
    if (day === null) return []
    const changed: string[] = []
    for (const [id, state] of this.activity) {
      const current = ratings.get(id)
      if (!current || day <= state.appliedThroughDay) continue
      const idleDays = (at: number) => Math.max(0, at - state.lastPlayedDay - INACTIVITY_GRACE_DAYS)
      const additionalIdleWeeks = (idleDays(day) - idleDays(state.appliedThroughDay)) / 7
      const rd = inactivityRatingDeviation(current.rd, additionalIdleWeeks)
      state.appliedThroughDay = day
      if (rd === current.rd) continue
      ratings.set(id, { ...current, rd })
      changed.push(id)
    }
    return changed
  }

  recordPlayed(playerIds: Iterable<string>, timestamp: string | null): void {
    const day = activityDay(timestamp)
    if (day === null) return
    for (const id of playerIds) {
      const previous = this.activity.get(id)
      // Historical season ordering can contain late entries. Never rewind time.
      const throughDay = Math.max(day, previous?.appliedThroughDay ?? day)
      this.activity.set(id, { lastPlayedDay: throughDay, appliedThroughDay: throughDay })
    }
  }
}
