import type { PlayerMatchEvent, PlayerRivalries, PlayerRivalry } from '../types'

const MIN_MEETINGS = 2

interface MeetingRow {
  opponentId: string
  result: 'W' | 'L'
  matchId: string
  date: string | null
  partnerName: string | null
  scoreLabel: string | null
  seasonName: string | null
}

function longestWinStreak(results: ('W' | 'L')[]): number {
  let best = 0
  let current = 0
  for (const result of results) {
    if (result === 'W') {
      current += 1
      best = Math.max(best, current)
    } else {
      current = 0
    }
  }
  return best
}

function buildRivalry(
  opponentId: string,
  opponentName: string,
  meetings: MeetingRow[],
): PlayerRivalry {
  const wins = meetings.filter((row) => row.result === 'W').length
  const losses = meetings.length - wins
  const latest = meetings[meetings.length - 1]!

  return {
    opponentId,
    opponentName,
    wins,
    losses,
    played: meetings.length,
    winRate: meetings.length > 0 ? wins / meetings.length : 0,
    longestWinStreak: longestWinStreak(meetings.map((row) => row.result)),
    latestMeeting: {
      matchId: latest.matchId,
      result: latest.result,
      date: latest.date,
      partnerName: latest.partnerName,
      scoreLabel: latest.scoreLabel,
      seasonName: latest.seasonName,
    },
  }
}

/**
 * Doubles-aware rivalries: each opposing player in a completed match is one H2H meeting.
 */
export function computePlayerRivalries(args: {
  events: PlayerMatchEvent[]
  nameById: Map<string, string>
}): PlayerRivalries {
  const meetingsByOpponent = new Map<string, MeetingRow[]>()

  for (const event of args.events) {
    for (const opponentId of event.opponentPoolIds) {
      const list = meetingsByOpponent.get(opponentId) ?? []
      list.push({
        opponentId,
        result: event.result,
        matchId: event.matchId,
        date: event.resultRecordedAt,
        partnerName: event.partnerName,
        scoreLabel: event.scoreLabel,
        seasonName: event.seasonName,
      })
      meetingsByOpponent.set(opponentId, list)
    }
  }

  const byOpponent: PlayerRivalry[] = []
  for (const [opponentId, meetings] of meetingsByOpponent) {
    meetings.sort((a, b) => {
      const dateDiff = (a.date ?? '').localeCompare(b.date ?? '')
      if (dateDiff !== 0) return dateDiff
      return a.matchId.localeCompare(b.matchId)
    })
    byOpponent.push(
      buildRivalry(opponentId, args.nameById.get(opponentId) ?? '?', meetings),
    )
  }

  byOpponent.sort((a, b) => {
    if (b.played !== a.played) return b.played - a.played
    if (b.wins !== a.wins) return b.wins - a.wins
    return a.opponentName.localeCompare(b.opponentName)
  })

  const qualified = byOpponent.filter((row) => row.played >= MIN_MEETINGS)

  let nemesis: PlayerRivalry | null = null
  for (const row of qualified) {
    if (row.losses === 0) continue
    if (
      !nemesis ||
      row.losses > nemesis.losses ||
      (row.losses === nemesis.losses && row.played > nemesis.played)
    ) {
      nemesis = row
    }
  }

  let favoriteOpponent: PlayerRivalry | null = null
  for (const row of qualified) {
    if (row.wins === 0) continue
    if (
      !favoriteOpponent ||
      row.wins > favoriteOpponent.wins ||
      (row.wins === favoriteOpponent.wins && row.winRate > favoriteOpponent.winRate) ||
      (row.wins === favoriteOpponent.wins &&
        row.winRate === favoriteOpponent.winRate &&
        row.played > favoriteOpponent.played)
    ) {
      favoriteOpponent = row
    }
  }

  return { nemesis, favoriteOpponent, byOpponent }
}

export function formatHeadToHeadLead(args: {
  playerName: string
  opponentName: string
  wins: number
  losses: number
}): string {
  if (args.wins === args.losses) {
    return `${args.playerName} and ${args.opponentName} are tied ${args.wins}–${args.losses}`
  }
  if (args.wins > args.losses) {
    return `${args.playerName} leads ${args.opponentName} ${args.wins}–${args.losses}`
  }
  return `${args.opponentName} leads ${args.playerName} ${args.losses}–${args.wins}`
}
