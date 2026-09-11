import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { ErrorState, LoadingState, SetupBanner } from '../components/Layout'
import { useRotationRealtime } from '../hooks/useRotationRealtime'
import {
  fetchRotationSnapshot,
  replaceRotationEvent,
  resetRotationEvent,
  returnRotationMatchToQueue,
  rotationSnapshotQueryKey,
  saveRotationResult,
  startRotationMatch,
} from '../lib/rotationApi'
import {
  generateRotationSchedule,
  getRotationStartableMatchIds,
  recommendRotationMatch,
  validateRotationConfiguration,
} from '../lib/rotationSchedule'
import {
  buildRotationStandings,
  getRotationPodium,
  validateRotationScore,
} from '../lib/rotationStandings'
import type {
  RotationMatch,
  RotationPlayer,
  RotationStanding,
} from '../lib/rotationTypes'

const inputClass =
  'min-h-11 w-full rounded-xl border border-cyan-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-cyan-500 sm:text-sm'
const primaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-200 bg-white px-4 py-2 text-sm font-bold text-cyan-900 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50'

type MobilePlannerSection = 'courts' | 'queue' | 'standings'

function sourcePlayerIds(count: number) {
  return Array.from({ length: count }, (_, index) => `player-${index + 1}`)
}

function newSeed() {
  return Math.floor(Math.random() * 2_147_483_647)
}

function waitForLoadingPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => window.setTimeout(resolve, 40))
  })
}

function matchPlayerIds(match: RotationMatch) {
  return [
    match.team_a_player_1_id,
    match.team_a_player_2_id,
    match.team_b_player_1_id,
    match.team_b_player_2_id,
  ]
}

function playerName(playersById: ReadonlyMap<string, RotationPlayer>, id: string) {
  return playersById.get(id)?.name ?? '—'
}

function MatchTeams({
  match,
  playersById,
  compact = false,
}: {
  match: RotationMatch
  playersById: ReadonlyMap<string, RotationPlayer>
  compact?: boolean
}) {
  const { t } = useTranslation()
  const teamClass = compact
    ? 'rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800'
    : 'rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-base font-bold text-white'
  return (
    <div className={`grid items-center gap-2 ${compact ? 'sm:grid-cols-[1fr_auto_1fr]' : 'grid-cols-[1fr_auto_1fr]'}`}>
      <div className={teamClass}>
        {playerName(playersById, match.team_a_player_1_id)}
        <span className="mx-1 text-cyan-500">+</span>
        {playerName(playersById, match.team_a_player_2_id)}
      </div>
      <span className={`text-center text-xs font-black uppercase ${compact ? 'text-slate-400' : 'text-cyan-100'}`}>
        {t('common.vs')}
      </span>
      <div className={teamClass}>
        {playerName(playersById, match.team_b_player_1_id)}
        <span className="mx-1 text-cyan-500">+</span>
        {playerName(playersById, match.team_b_player_2_id)}
      </div>
    </div>
  )
}

function ScoreForm({
  match,
  playersById,
  isSaving,
  onSave,
  tone = 'court',
}: {
  match: RotationMatch
  playersById: ReadonlyMap<string, RotationPlayer>
  isSaving: boolean
  onSave: (teamAScore: number, teamBScore: number) => void
  tone?: 'court' | 'edit'
}) {
  const { t } = useTranslation()
  const [teamA, setTeamA] = useState(match.team_a_score?.toString() ?? '')
  const [teamB, setTeamB] = useState(match.team_b_score?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const a = Number(teamA)
    const b = Number(teamB)
    try {
      validateRotationScore(a, b)
      setError(null)
      onSave(a, b)
    } catch {
      setError(t('rotation.scoreInvalid'))
    }
  }

  return (
    <div className="mt-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label className={`text-xs font-bold ${tone === 'court' ? 'text-cyan-50' : 'text-slate-700'}`}>
          {playerName(playersById, match.team_a_player_1_id)} + {playerName(playersById, match.team_a_player_2_id)}
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={teamA}
            onChange={(event) => setTeamA(event.target.value)}
            className="mt-1 min-h-12 w-full rounded-xl border border-white/20 bg-white px-3 text-center text-xl font-black text-slate-950"
            aria-label={t('rotation.teamAScore')}
          />
        </label>
        <span className={`pb-3 text-sm font-black ${tone === 'court' ? 'text-cyan-100' : 'text-slate-400'}`}>–</span>
        <label className={`text-xs font-bold ${tone === 'court' ? 'text-cyan-50' : 'text-slate-700'}`}>
          {playerName(playersById, match.team_b_player_1_id)} + {playerName(playersById, match.team_b_player_2_id)}
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={teamB}
            onChange={(event) => setTeamB(event.target.value)}
            className="mt-1 min-h-12 w-full rounded-xl border border-white/20 bg-white px-3 text-center text-xl font-black text-slate-950"
            aria-label={t('rotation.teamBScore')}
          />
        </label>
      </div>
      {error ? <p className={`mt-2 text-xs font-semibold ${tone === 'court' ? 'text-amber-200' : 'text-red-700'}`}>{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={isSaving || teamA === '' || teamB === ''}
        className={`mt-3 min-h-11 w-full rounded-xl px-4 py-2 text-sm font-black disabled:opacity-50 ${tone === 'court' ? 'bg-white text-cyan-900 hover:bg-cyan-50' : 'bg-cyan-600 text-white hover:bg-cyan-700'}`}
      >
        {isSaving ? t('rotation.savingScore') : t('rotation.saveScore')}
      </button>
    </div>
  )
}

function StandingsTable({ standings }: { standings: RotationStanding[] }) {
  const { t } = useTranslation()
  const formatDifferential = (value: number) => value > 0 ? `+${value}` : String(value)
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-2 py-3">#</th>
            <th className="px-2 py-3">{t('rotation.player')}</th>
            <th className="px-2 py-3 text-center">{t('rotation.played')}</th>
            <th className="px-2 py-3 text-center">{t('rotation.points')}</th>
            <th className="px-2 py-3 text-center">{t('rotation.pointDifference')}</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.playerId} className="border-b border-slate-100 last:border-0">
              <td className="px-2 py-3 font-black text-cyan-700">{row.rank}</td>
              <td className="px-2 py-3 font-bold text-slate-900">{row.name}</td>
              <td className="px-2 py-3 text-center">{row.played}</td>
              <td className="px-2 py-3 text-center font-black text-emerald-700">{row.wins}</td>
              <td className={`px-2 py-3 text-center font-black tabular-nums ${row.pointDifferential > 0 ? 'text-emerald-700' : row.pointDifferential < 0 ? 'text-red-600' : 'text-slate-500'}`}>{formatDifferential(row.pointDifferential)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  destructive,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  busy: boolean
  error: Error | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-sm sm:items-center" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="rotation-confirm-title"
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      >
        <h2 id="rotation-confirm-title" className="text-xl font-black text-slate-950">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
        {error ? <div className="mt-4"><ErrorState message={error.message} /></div> : null}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className={secondaryButton}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-cyan-600 hover:bg-cyan-700'}`}
          >
            {busy ? t('rotation.working') : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

function ScheduleLoadingOverlay() {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div role="status" aria-live="polite" className="w-full max-w-sm rounded-3xl bg-white p-7 text-center shadow-2xl">
        <span className="mx-auto block size-12 animate-spin rounded-full border-4 border-cyan-100 border-t-cyan-600" aria-hidden="true" />
        <h2 className="mt-5 text-xl font-black text-slate-950">{t('rotation.generationTitle')}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t('rotation.generationDescription')}</p>
      </div>
    </div>
  )
}

function PlannerSetup({
  isSaving,
  error,
  onCreate,
}: {
  isSaving: boolean
  error: Error | null
  onCreate: (input: {
    name: string
    playerNames: string[]
    matchesPerPlayer: number
    courtCount: number
  }) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(t('rotation.defaultEventName'))
  const [playerCount, setPlayerCount] = useState(10)
  const [playerCountInput, setPlayerCountInput] = useState('10')
  const [matchesPerPlayer, setMatchesPerPlayer] = useState(6)
  const [courtCount, setCourtCount] = useState(2)
  const [playerNames, setPlayerNames] = useState(() =>
    Array.from({ length: 10 }, (_, index) => t('rotation.defaultPlayerName', { number: index + 1 })),
  )
  const validation = validateRotationConfiguration(playerCount, matchesPerPlayer, courtCount)
  const validationMessage = validation.code
    ? t(`rotation.validation.${validation.code}`, {
        maximumMatches: Math.max(1, playerCount - 1),
        maximumCourts: Math.max(1, Math.floor(playerCount / 4)),
      })
    : null
  const trimmedNames = playerNames.map((playerName) => playerName.trim())
  const namesValid =
    trimmedNames.every(Boolean) &&
    new Set(trimmedNames.map((playerName) => playerName.toLocaleLowerCase())).size === playerCount
  const playerCountInputValid = playerCountInput === String(playerCount)

  function changePlayerCount(value: number) {
    const nextCount = Math.max(4, Math.min(40, Math.trunc(value || 4)))
    setPlayerCount(nextCount)
    setPlayerCountInput(String(nextCount))
    setPlayerNames((current) =>
      Array.from(
        { length: nextCount },
        (_, index) => current[index] ?? t('rotation.defaultPlayerName', { number: index + 1 }),
      ),
    )
    setCourtCount((current) => Math.min(current, Math.floor(nextCount / 4)))
    setMatchesPerPlayer((current) => Math.min(current, nextCount - 1))
  }

  function editPlayerCount(value: string) {
    setPlayerCountInput(value)
    if (value === '') return
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed >= 4 && parsed <= 40) {
      changePlayerCount(parsed)
    }
  }

  return (
    <div className="grid gap-4 sm:gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-cyan-950 to-cyan-700 p-5 text-white shadow-xl sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">{t('rotation.setupEyebrow')}</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight sm:mt-3 sm:text-3xl">{t('rotation.title')}</h1>
        <p className="mt-2 text-sm leading-6 text-cyan-100 sm:mt-3">{t('rotation.setupDescription')}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-7">
          <div className="rounded-2xl bg-white/10 p-3 text-center"><p className="text-2xl font-black">{playerCount}</p><p className="text-xs text-cyan-100">{t('rotation.players')}</p></div>
          <div className="rounded-2xl bg-white/10 p-3 text-center"><p className="text-2xl font-black">{matchesPerPlayer}</p><p className="text-xs text-cyan-100">{t('rotation.each')}</p></div>
          <div className="rounded-2xl bg-white/10 p-3 text-center"><p className="text-2xl font-black">{validation.valid ? (playerCount * matchesPerPlayer) / 4 : '—'}</p><p className="text-xs text-cyan-100">{t('rotation.matches')}</p></div>
        </div>
        <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-50 sm:mt-5">{t('rotation.noRepeatPromise')}</p>
      </section>

      <form
        className="rounded-3xl border border-cyan-100 bg-white p-4 pb-24 shadow-sm sm:p-7"
        onSubmit={(event) => {
          event.preventDefault()
          if (validation.valid && playerCountInputValid && namesValid && name.trim()) {
            onCreate({ name: name.trim(), playerNames: trimmedNames, matchesPerPlayer, courtCount })
          }
        }}
      >
        <h2 className="text-xl font-black text-slate-950">{t('rotation.eventSetup')}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-4">
          <label className="col-span-2 text-sm font-bold text-slate-700">
            {t('rotation.eventName')}
            <input value={name} onChange={(event) => setName(event.target.value)} className={`${inputClass} mt-1`} maxLength={120} />
          </label>
          <label className="text-sm font-bold text-slate-700">
            {t('rotation.playerCount')}
            <input type="number" min="4" max="40" inputMode="numeric" value={playerCountInput} onFocus={(event) => event.currentTarget.select()} onChange={(event) => editPlayerCount(event.target.value)} onBlur={() => changePlayerCount(Number(playerCountInput))} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-sm font-bold text-slate-700">
            {t('rotation.courtCount')}
            <input type="number" min="1" max={Math.floor(playerCount / 4)} value={courtCount} onChange={(event) => setCourtCount(Number(event.target.value))} className={`${inputClass} mt-1`} />
          </label>
          <label className="col-span-2 text-sm font-bold text-slate-700 sm:col-span-1 lg:col-span-2">
            {t('rotation.matchesEach')}
            <input type="number" min="1" max={playerCount - 1} value={matchesPerPlayer} onChange={(event) => setMatchesPerPlayer(Number(event.target.value))} className={`${inputClass} mt-1`} />
          </label>
        </div>

        {!validation.valid ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-bold">{validationMessage}</p>
            {validation.suggestedMatchesPerPlayer.length > 0 ? <p className="mt-1">{t('rotation.tryMatches', { values: validation.suggestedMatchesPerPlayer.join(' or ') })}</p> : null}
          </div>
        ) : null}

        <div className="mt-5 sm:mt-6">
          <div className="flex items-end justify-between gap-3">
            <div><h3 className="font-black text-slate-950">{t('rotation.playerNames')}</h3><p className="text-sm text-slate-500">{t('rotation.uniqueNames')}</p></div>
            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">{playerCount}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
            {playerNames.map((playerName, index) => (
              <label key={index} className="text-xs font-bold text-slate-500">
                {t('rotation.playerNumber', { number: index + 1 })}
                <input value={playerName} maxLength={80} onChange={(event) => setPlayerNames((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} className={`${inputClass} mt-1`} />
              </label>
            ))}
          </div>
          {!namesValid ? <p className="mt-3 text-sm font-semibold text-red-700">{t('rotation.namesError')}</p> : null}
        </div>

        {error ? <div className="mt-5"><ErrorState message={error.message} /></div> : null}
        <div className="fixed inset-x-4 bottom-4 z-30 rounded-2xl border border-cyan-100 bg-white/95 p-2 shadow-xl backdrop-blur sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <button type="submit" disabled={isSaving || !validation.valid || !playerCountInputValid || !namesValid || !name.trim()} className={`${primaryButton} w-full`}>
            {isSaving ? t('rotation.generating') : t('rotation.generate')}
          </button>
        </div>
      </form>
    </div>
  )
}

function PlannerEvent({
  players,
  matches,
  event,
  connectionStatus,
  onRegenerate,
  onReset,
}: {
  players: RotationPlayer[]
  matches: RotationMatch[]
  event: NonNullable<Awaited<ReturnType<typeof fetchRotationSnapshot>>>['event']
  connectionStatus: ReturnType<typeof useRotationRealtime>['status']
  onRegenerate: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mobileSection, setMobileSection] = useState<MobilePlannerSection>('courts')
  const [showAllQueue, setShowAllQueue] = useState(false)
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players])
  const standings = useMemo(() => buildRotationStandings(players, matches), [players, matches])
  const podium = getRotationPodium(standings, event.status === 'completed')
  const recommended = useMemo(
    () => recommendRotationMatch(matches, players, event.court_count),
    [event.court_count, matches, players],
  )
  const startableMatchIds = useMemo(
    () => getRotationStartableMatchIds(matches, event.court_count),
    [event.court_count, matches],
  )
  const completed = matches.filter((match) => match.status === 'completed')
  const available = matches.filter((match) => match.status === 'available')
  const orderedAvailable = recommended
    ? [recommended, ...available.filter((match) => match.id !== recommended.id)]
    : available
  const progress = matches.length > 0 ? Math.round((completed.length / matches.length) * 100) : 0

  const refresh = () => queryClient.invalidateQueries({ queryKey: rotationSnapshotQueryKey })
  const startMutation = useMutation({
    mutationFn: ({ match, court }: { match: RotationMatch; court: number }) =>
      startRotationMatch(match.id, court, match.revision),
    onSuccess: refresh,
  })
  const queueMutation = useMutation({
    mutationFn: (match: RotationMatch) => returnRotationMatchToQueue(match.id, match.revision),
    onSuccess: refresh,
  })
  const scoreMutation = useMutation({
    mutationFn: ({ match, a, b }: { match: RotationMatch; a: number; b: number }) =>
      saveRotationResult(match.id, a, b, match.revision),
    onSuccess: refresh,
  })
  const actionError = startMutation.error ?? queueMutation.error ?? scoreMutation.error
  const emptyCourts = Array.from({ length: event.court_count }, (_, index) => index + 1).filter(
    (court) => !matches.some((match) => match.status === 'playing' && match.court_number === court),
  )

  return (
    <div>
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-cyan-950 to-cyan-700 p-5 text-white shadow-xl sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-cyan-400 px-3 py-1 text-xs font-black uppercase tracking-wider text-cyan-950">{event.status === 'completed' ? t('rotation.complete') : t('rotation.live')}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${connectionStatus === 'connected' ? 'bg-emerald-400/20 text-emerald-100' : 'bg-amber-300/20 text-amber-100'}`}>{t(`rotation.connection.${connectionStatus}`)}</span>
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight">{event.name}</h1>
            <p className="mt-1 text-sm text-cyan-100">{t('rotation.eventSummary', { players: players.length, matches: event.matches_per_player, courts: event.court_count })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {event.status === 'draft' ? <button type="button" onClick={onRegenerate} className="min-h-10 rounded-xl border border-white/25 px-3 py-2 text-sm font-bold hover:bg-white/10">{t('rotation.regenerate')}</button> : null}
            <button type="button" onClick={onReset} className="min-h-10 rounded-xl border border-red-200/40 bg-red-500/15 px-3 py-2 text-sm font-bold text-red-50 hover:bg-red-500/25">{t('rotation.reset')}</button>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between text-xs font-bold text-cyan-50"><span>{t('rotation.progress')}</span><span>{completed.length}/{matches.length}</span></div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-cyan-300 transition-[width]" style={{ width: `${progress}%` }} /></div>
      </section>

      {actionError ? <div className="mt-5"><ErrorState message={(actionError as Error).message} /></div> : null}

      {event.status === 'completed' ? (
        <section className="mt-6 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-100 p-6 text-center shadow-sm">
          <p className="text-4xl" aria-hidden="true">🏆</p>
          <h2 className="mt-2 text-2xl font-black text-amber-950">{t('rotation.finalPodium')}</h2>
          <div className="mx-auto mt-5 grid max-w-2xl gap-3 sm:grid-cols-3">
            {podium.map((row, index) => (
              <div key={row.playerId} className={`rounded-2xl border bg-white p-4 shadow-sm ${index === 0 ? 'border-amber-400 sm:-translate-y-2' : 'border-amber-200'}`}>
                <p className="text-2xl">{['🥇', '🥈', '🥉'][index]}</p><p className="mt-1 font-black text-slate-950">{row.name}</p><p className="text-sm text-slate-600">{t('rotation.pointRecord', { points: row.wins, played: row.played })}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <nav className="sticky top-2 z-20 mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-cyan-100 bg-white/95 p-1.5 shadow-lg backdrop-blur xl:hidden" role="tablist" aria-label={t('rotation.mobileSections')}>
        {([
          ['courts', t('rotation.courtsTab')],
          ['queue', t('rotation.queueTab')],
          ['standings', t('rotation.standingsTab')],
        ] as const).map(([section, label]) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={mobileSection === section}
            onClick={() => setMobileSection(section)}
            className={`min-h-11 rounded-xl px-2 py-2 text-sm font-black transition ${mobileSection === section ? 'bg-cyan-600 text-white shadow-sm' : 'text-cyan-900 hover:bg-cyan-50'}`}
          >
            {label}{section === 'queue' ? <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${mobileSection === section ? 'bg-white/20' : 'bg-cyan-100'}`}>{available.length}</span> : null}
          </button>
        ))}
      </nav>

      <div className="mt-4 grid gap-6 sm:mt-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-6">
          <section className={mobileSection === 'courts' ? 'block' : 'hidden xl:block'} role="tabpanel">
            <div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-cyan-700">{t('rotation.courtsEyebrow')}</p><h2 className="text-xl font-black text-slate-950">{t('rotation.courts')}</h2></div><span className="text-sm text-slate-500">{t('rotation.flexibleHint')}</span></div>
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: event.court_count }, (_, index) => index + 1).map((court) => {
                const playing = matches.find((match) => match.status === 'playing' && match.court_number === court)
                return (
                  <article key={court} className={`min-h-64 rounded-3xl p-5 shadow-sm ${playing ? 'bg-gradient-to-br from-cyan-800 to-cyan-600' : 'border-2 border-dashed border-cyan-200 bg-cyan-50/50'}`}>
                    <div className="flex items-center justify-between"><h3 className={`text-sm font-black uppercase tracking-wider ${playing ? 'text-cyan-100' : 'text-cyan-800'}`}>{t('rotation.court', { number: court })}</h3>{playing ? <span className="rounded-full bg-red-500 px-2.5 py-1 text-xs font-black text-white">{t('rotation.playing')}</span> : null}</div>
                    {playing ? <><div className="mt-4"><MatchTeams match={playing} playersById={playersById} /></div><ScoreForm match={playing} playersById={playersById} isSaving={scoreMutation.isPending} onSave={(a, b) => scoreMutation.mutate({ match: playing, a, b })} /><button type="button" disabled={queueMutation.isPending} onClick={() => queueMutation.mutate(playing)} className="mt-2 min-h-10 w-full text-xs font-bold text-cyan-100 underline underline-offset-4 disabled:opacity-50">{t('rotation.returnQueue')}</button></> : recommended ? <><p className="mt-5 text-xs font-bold uppercase tracking-wide text-cyan-700">{t('rotation.recommended')}</p><div className="mt-2"><MatchTeams match={recommended} playersById={playersById} compact /></div><button type="button" disabled={startMutation.isPending || connectionStatus === 'offline'} onClick={() => startMutation.mutate({ match: recommended, court })} className={`${primaryButton} mt-5 w-full`}>{t('rotation.startMatch')}</button></> : <div className="flex min-h-48 items-center justify-center text-center text-sm text-slate-500">{available.length > 0 ? t('rotation.waitingPlayers') : t('rotation.noMatchesWaiting')}</div>}
                  </article>
                )
              })}
            </div>
          </section>

          <section className={`${mobileSection === 'queue' ? 'block' : 'hidden xl:block'} rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5`} role="tabpanel">
            <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-cyan-700">{t('rotation.queueEyebrow')}</p><h2 className="text-xl font-black text-slate-950">{t('rotation.waitingMatches')}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{available.length}</span></div>
            <div className="mt-4 space-y-3">
              {available.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{t('rotation.queueEmpty')}</p> : orderedAvailable.map((match, index) => {
                const blocked = matchPlayerIds(match).some((id) => matches.some((active) => active.status === 'playing' && matchPlayerIds(active).includes(id)))
                const strandsCourt = !blocked && !startableMatchIds.has(match.id)
                return <article key={match.id} className={`${index >= 3 && !showAllQueue ? 'hidden xl:block' : 'block'} rounded-2xl border p-4 ${recommended?.id === match.id ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200'}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-black text-slate-500">{t('rotation.matchNumber', { number: match.sequence_number })}</span>{recommended?.id === match.id ? <span className="rounded-full bg-cyan-600 px-2.5 py-1 text-xs font-black text-white">{t('rotation.bestNext')}</span> : null}</div><div className="mt-2"><MatchTeams match={match} playersById={playersById} compact /></div><div className="mt-3 flex flex-wrap gap-2">{emptyCourts.map((court) => <button key={court} type="button" disabled={blocked || strandsCourt || startMutation.isPending || connectionStatus === 'offline'} onClick={() => startMutation.mutate({ match, court })} className={secondaryButton}>{t('rotation.startCourt', { number: court })}</button>)}</div>{blocked ? <p className="mt-2 text-xs font-semibold text-amber-700">{t('rotation.playersBusy')}</p> : strandsCourt ? <p className="mt-2 text-xs font-semibold text-amber-700">{t('rotation.blocksOtherCourts')}</p> : null}</article>
              })}
              {available.length > 3 ? <button type="button" onClick={() => setShowAllQueue((current) => !current)} className={`${secondaryButton} w-full xl:hidden`}>{showAllQueue ? t('rotation.showFewerMatches') : t('rotation.showAllMatches', { count: available.length })}</button> : null}
            </div>
          </section>

          {completed.length > 0 ? <details className={`${mobileSection === 'queue' ? 'block' : 'hidden xl:block'} rounded-3xl border border-slate-200 bg-white p-5 shadow-sm`}><summary className="cursor-pointer text-lg font-black text-slate-950">{t('rotation.completedMatches', { count: completed.length })}</summary><div className="mt-4 space-y-3">{completed.slice().reverse().map((match) => <article key={match.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold text-slate-500">{t('rotation.matchNumber', { number: match.sequence_number })}</span><span className="text-lg font-black text-slate-950">{match.team_a_score}–{match.team_b_score}</span></div><div className="mt-2"><MatchTeams match={match} playersById={playersById} compact /></div><ScoreForm key={`${match.id}-${match.revision}`} match={match} playersById={playersById} isSaving={scoreMutation.isPending} onSave={(a, b) => scoreMutation.mutate({ match, a, b })} tone="edit" /></article>)}</div></details> : null}
        </div>

        <aside className={`${mobileSection === 'standings' ? 'block' : 'hidden xl:block'} min-w-0 xl:sticky xl:top-5 xl:self-start`} role="tabpanel">
          <section className="rounded-3xl border border-cyan-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wider text-cyan-700">{event.status === 'completed' ? t('rotation.final') : t('rotation.provisional')}</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">{t('rotation.standings')}</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">{t('rotation.rankingNote')}</p>
            <div className="mt-4"><StandingsTable standings={standings} /></div>
          </section>
        </aside>
      </div>
    </div>
  )
}

export function MatchPlannerPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<'regenerate' | 'reset' | null>(null)
  const snapshotQuery = useQuery({ queryKey: rotationSnapshotQueryKey, queryFn: fetchRotationSnapshot })
  const connection = useRotationRealtime()
  const createMutation = useMutation({
    mutationFn: async (input: { name: string; playerNames: string[]; matchesPerPlayer: number; courtCount: number }) => {
      await waitForLoadingPaint()
      const seed = newSeed()
      const schedule = generateRotationSchedule(sourcePlayerIds(input.playerNames.length), input.matchesPerPlayer, input.courtCount, seed)
      return replaceRotationEvent({ ...input, seed, schedule })
    },
    onSuccess: async () => {
      const savedSnapshot = await fetchRotationSnapshot()
      queryClient.setQueryData(rotationSnapshotQueryKey, savedSnapshot)
    },
  })
  const resetMutation = useMutation({
    mutationFn: resetRotationEvent,
    onSuccess: () => queryClient.setQueryData(rotationSnapshotQueryKey, null),
  })

  const snapshot = snapshotQuery.data
  function regenerate() {
    if (!snapshot) return
    createMutation.mutate({
      name: snapshot.event.name,
      playerNames: snapshot.players.map((player) => player.name),
      matchesPerPlayer: snapshot.event.matches_per_player,
      courtCount: snapshot.event.court_count,
    }, { onSuccess: () => setPendingAction(null) })
  }
  function reset() {
    if (!snapshot) return
    resetMutation.mutate(snapshot.event.id, { onSuccess: () => setPendingAction(null) })
  }

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_right,_#cffafe_0,_#f8fafc_38%,_#ecfeff_100%)] text-slate-900">
      <header className="border-b border-cyan-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-black text-cyan-900 hover:bg-cyan-50"><span aria-hidden="true">←</span>{t('rotation.backToLeague')}</Link>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <SetupBanner />
        {snapshotQuery.isLoading ? <LoadingState /> : snapshotQuery.error ? <ErrorState message={(snapshotQuery.error as Error).message} /> : snapshot ? <PlannerEvent event={snapshot.event} players={snapshot.players} matches={snapshot.matches} connectionStatus={connection.status} onRegenerate={() => setPendingAction('regenerate')} onReset={() => setPendingAction('reset')} /> : <PlannerSetup isSaving={createMutation.isPending} error={createMutation.error as Error | null} onCreate={(input) => createMutation.mutate(input)} />}
        {resetMutation.error ? <div className="mt-5"><ErrorState message={(resetMutation.error as Error).message} /></div> : null}
      </main>
      {pendingAction ? (
        <ConfirmationDialog
          title={t(`rotation.${pendingAction}Title`)}
          message={t(`rotation.${pendingAction}Confirm`)}
          confirmLabel={t(`rotation.confirm${pendingAction === 'reset' ? 'Reset' : 'Regenerate'}`)}
          destructive={pendingAction === 'reset'}
          busy={pendingAction === 'reset' ? resetMutation.isPending : createMutation.isPending}
          error={(pendingAction === 'reset' ? resetMutation.error : createMutation.error) as Error | null}
          onCancel={() => setPendingAction(null)}
          onConfirm={pendingAction === 'reset' ? reset : regenerate}
        />
      ) : null}
      {createMutation.isPending && pendingAction !== 'regenerate' ? <ScheduleLoadingOverlay /> : null}
    </div>
  )
}
