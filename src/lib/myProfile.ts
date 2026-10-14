import { computeCurrentStreak } from './engagement'
import { buildPersonalTournament } from './personalTournament'
import { buildPlayerMatchEvents } from './playerMatches'
import { computePlayerRivalries } from './rivalries'
import type { MatchWithTeams, PlayerProfile, RatingHistoryPoint } from '../types'
import type { PickleTransaction } from './betsApi'

export const PROFILE_TABS = ['overview', 'stats', 'matches', 'points', 'settings'] as const
export type ProfileTab = typeof PROFILE_TABS[number]
export function profileTab(value: string | null): ProfileTab {
  return PROFILE_TABS.find(tab => tab === value) ?? 'overview'
}

/** Login may return only to this league's personal hub, never an external URL. */
export function profileReturnTo(value: string | null, leaguePath: string): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const url = new URL(value, 'https://profile.invalid')
    if (url.origin !== 'https://profile.invalid' || url.pathname !== `${leaguePath}/me`) return null
    return `${url.pathname}${url.search}`
  } catch { return null }
}

export function ratingChanges(history: RatingHistoryPoint[]): Map<string, number> {
  const changes = new Map<string, number>()
  const ordered = [...history].sort((a, b) => a.sequence - b.sequence)
  for (let i = 1; i < ordered.length; i++) {
    const point = ordered[i]!
    if (point.matchId) changes.set(point.matchId, point.rating - ordered[i - 1]!.rating)
  }
  return changes
}

/** Retain each real predecessor so charts/swing stats never bridge a history gap. */
function seasonHistory(history: RatingHistoryPoint[], matchIds: Set<string>): RatingHistoryPoint[] {
  const ordered = [...history].sort((a, b) => a.sequence - b.sequence)
  const selected = new Set<number>()
  ordered.forEach((point, index) => {
    if (point.matchId && matchIds.has(point.matchId)) {
      selected.add(index)
      if (index > 0) selected.add(index - 1)
    }
  })
  return ordered.filter((_, index) => selected.has(index)).map(point =>
    point.matchId && !matchIds.has(point.matchId)
      ? { ...point, matchId: null, result: null, partnerName: null, opponentNames: [] } : point)
}

export function selectedSeasonStats(profile: PlayerProfile, seasonId: string, matches: MatchWithTeams[], nameById: Map<string, string>, seasonName: string) {
  const summary = buildPersonalTournament(profile.id, seasonId, matches, profile.history)
  const events = buildPlayerMatchEvents({ poolPlayerId: profile.id, matches: matches.filter(match => match.season_id === seasonId), nameById, seasonNameById: new Map([[seasonId, seasonName]]) })
  const matchIds = new Set(events.map(event => event.matchId))
  const history = seasonHistory(profile.history, matchIds)
  const partners = new Map<string, { name: string; wins: number; played: number }>()
  for (const event of events) {
    if (!event.partnerPoolId) continue
    const partner = partners.get(event.partnerPoolId) ?? { name: event.partnerName ?? '?', wins: 0, played: 0 }
    partner.played++
    if (event.result === 'W') partner.wins++
    partners.set(event.partnerPoolId, partner)
  }
  const candidates = [...partners.values()]
  const qualified = candidates.filter(partner => partner.played >= 2)
  const bestPartner = (qualified.length ? qualified : candidates).sort((a, b) =>
    (qualified.length ? b.wins / b.played - a.wins / a.played : b.wins - a.wins)
    || b.played - a.played || a.name.localeCompare(b.name))[0] ?? null
  const changes = ratingChanges(profile.history)
  const biggest = events.filter(event => changes.has(event.matchId)).sort((a, b) => Math.abs(changes.get(b.matchId)!) - Math.abs(changes.get(a.matchId)!))[0]
  return {
    played: summary.played, wins: summary.wins, losses: summary.losses,
    winRate: summary.played ? summary.wins / summary.played : 0,
    form: events.slice(-5).map(event => event.result), ratingDelta: summary.ratingDelta,
    forfeits: summary.forfeits, history,
    funStats: {
      currentStreak: computeCurrentStreak(events.map(event => event.result)), bestPartner,
      toughestOpponent: null,
      biggestSwing: biggest ? { delta: changes.get(biggest.matchId)!, result: biggest.result, partnerName: biggest.partnerName, opponentNames: biggest.opponentNames, scoreLabel: biggest.scoreLabel, seasonName, resultRecordedAt: biggest.resultRecordedAt } : null,
    },
    rivalries: computePlayerRivalries({ events, nameById }),
  }
}

/** Sum six-decimal ledger values without converting points to floating point. */
export function totalPrizes(history: PickleTransaction[]): string {
  const total = history.filter(item => item.kind === 'prize').reduce((sum, item) => {
    const negative = item.amount.startsWith('-')
    const [whole, fraction = ''] = item.amount.replace(/^-/, '').split('.')
    const amount = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
    return sum + (negative ? -amount : amount)
  }, 0n)
  const absolute = total < 0n ? -total : total
  return `${total < 0n ? '-' : ''}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, '0')}`
}
