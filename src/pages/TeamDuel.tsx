import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AdminLoginForm } from '../components/AdminLoginForm'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { ErrorState, LoadingState, SetupBanner } from '../components/Layout'
import { useAuth } from '../context/AuthContext'
import { useTeamDuelRealtime } from '../hooks/useTeamDuelRealtime'
import { formatMatchDate } from '../lib/formatDate'
import {
  activateTeamDuelEvent,
  createTeamDuelTiebreak,
  deleteTeamDuelDraft,
  deleteTeamDuelHistory,
  deleteTeamDuelSquad,
  fetchTeamDuelEvents,
  fetchTeamDuelRegisteredPlayers,
  fetchTeamDuelSnapshot,
  fetchTeamDuelSquads,
  returnTeamDuelMatchToQueue,
  saveTeamDuelDraft,
  saveTeamDuelResult,
  saveTeamDuelSquad,
  setTeamDuelSquadArchived,
  startTeamDuelMatch,
  teamDuelEventsQueryKey,
  teamDuelPlayersQueryKey,
  teamDuelSnapshotQueryKey,
  teamDuelSquadsQueryKey,
} from '../lib/teamDuelApi'
import {
  generateTeamDuelSchedule,
  getTeamDuelScore,
  teamDuelPlayerName,
  validateTeamDuelScore,
} from '../lib/teamDuelSchedule'
import type {
  TeamDuelEvent,
  TeamDuelEventPlayer,
  TeamDuelMatch,
  TeamDuelRegisteredPlayer,
  TeamDuelSnapshot,
  TeamDuelSquad,
} from '../lib/teamDuelTypes'

const inputClass =
  'min-h-11 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-base text-slate-950 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:text-sm'
const primaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-900 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50'

function localDateInputValue() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

type HubTab = 'current' | 'history' | 'squads'

function TeamDuelShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { isAdmin, signOut } = useAuth()
  return (
    <div className="min-h-dvh bg-gradient-to-b from-indigo-50 via-white to-violet-50">
      <header className="border-b border-indigo-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-700 font-black text-white" aria-label={t('teamDuel.backToLeagues')}>
              TD
            </Link>
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-indigo-950">{t('teamDuel.title')}</p>
              <p className="hidden text-xs font-semibold text-indigo-600 sm:block">{t('teamDuel.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin ? <Link to="/players" className={secondaryButton}>{t('nav.players')}</Link> : null}
            <Link to="/" className={secondaryButton}>
              <span aria-hidden="true">←</span> {t('teamDuel.backToLeagues')}
            </Link>
            <LanguageSwitcher />
            {isAdmin ? (
              <button type="button" onClick={() => void signOut()} className={secondaryButton}>
                {t('auth.signOut')}
              </button>
            ) : (
              <Link to="/team-duel/login" className={secondaryButton}>{t('auth.admin')}</Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
        <SetupBanner />
        {children}
      </main>
    </div>
  )
}

export function TeamDuelLoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  return (
    <TeamDuelShell>
      {isAdmin ? (
        <div className="mx-auto max-w-md rounded-2xl border border-indigo-100 bg-white p-6 text-center shadow-sm">
          <Link to="/team-duel" className={primaryButton}>{t('teamDuel.title')}</Link>
        </div>
      ) : (
        <AdminLoginForm onSuccess={() => navigate('/team-duel', { replace: true })} />
      )}
    </TeamDuelShell>
  )
}

function EventName({ event, squads }: { event: TeamDuelEvent; squads?: TeamDuelSquad[] }) {
  const squadNames = new Map(squads?.map((squad) => [squad.id, squad.name]) ?? [])
  const defaultName = `${event.squad_a_name ?? squadNames.get(event.squad_a_id) ?? '—'} vs ${event.squad_b_name ?? squadNames.get(event.squad_b_id) ?? '—'}`
  return <>{event.title || defaultName}</>
}

function EventCard({
  event,
  squads,
  onDelete,
  deleting = false,
}: {
  event: TeamDuelEvent
  squads?: TeamDuelSquad[]
  onDelete?: (event: TeamDuelEvent) => void
  deleting?: boolean
}) {
  const { t, i18n } = useTranslation()
  const date = formatMatchDate(event.event_date, i18n.language)
  return (
    <article className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
      <Link to={`/team-duel/events/${event.id}`} className="block rounded-xl transition hover:bg-indigo-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        <div className="flex flex-wrap items-start justify-between gap-2 p-1">
          <div>
            <h3 className="font-black text-slate-950"><EventName event={event} squads={squads} /></h3>
            <p className="mt-1 text-sm text-slate-500">{date}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${event.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : event.status === 'draft' ? 'bg-slate-100 text-slate-700' : 'bg-indigo-100 text-indigo-800'}`}>
            {t(`teamDuel.status.${event.status}`)}
          </span>
        </div>
      </Link>
      {onDelete ? (
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
          <button
            type="button"
            disabled={deleting}
            onClick={() => onDelete(event)}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? t('teamDuel.deletingHistory') : t('teamDuel.deleteHistory')}
          </button>
        </div>
      ) : null}
    </article>
  )
}

function SquadEditor({
  players,
  squad,
  onCancel,
  onSave,
  saving,
}: {
  players: TeamDuelRegisteredPlayer[]
  squad: TeamDuelSquad | null
  onCancel: () => void
  onSave: (input: { name: string; playerIds: string[] }) => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const initialMembers = squad?.members.map((member) => member.pool_player_id) ?? []
  const [name, setName] = useState(squad?.name ?? '')
  const [size, setSize] = useState(initialMembers.length || 4)
  const [playerIds, setPlayerIds] = useState<string[]>(() =>
    Array.from({ length: initialMembers.length || 4 }, (_, index) => initialMembers[index] ?? ''),
  )
  const complete = name.trim() !== '' && playerIds.length === size && playerIds.every(Boolean)
    && new Set(playerIds).size === size

  function changeSize(nextSize: number) {
    setSize(nextSize)
    setPlayerIds((current) =>
      Array.from({ length: nextSize }, (_, index) => current[index] ?? ''),
    )
  }

  return (
    <form
      className="rounded-3xl border border-indigo-200 bg-indigo-50 p-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (complete) onSave({ name: name.trim(), playerIds })
      }}
    >
      <h3 className="text-lg font-black text-indigo-950">{squad ? t('teamDuel.editSquad') : t('teamDuel.newSquad')}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-800">
          {t('teamDuel.squadName')}
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm font-bold text-slate-800">
          {t('teamDuel.rosterSize')}
          <select value={size} onChange={(event) => changeSize(Number(event.target.value))} className={`${inputClass} mt-1`}>
            {[4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-5 space-y-3">
        {playerIds.map((playerId, index) => (
          <label key={index} className="grid items-center gap-2 text-sm font-bold text-slate-800 sm:grid-cols-[8rem_1fr]">
            <span>{t('teamDuel.rankLabel', { rank: index + 1 })}</span>
            <select
              value={playerId}
              onChange={(event) => setPlayerIds((current) => current.map((value, playerIndex) => playerIndex === index ? event.target.value : value))}
              className={inputClass}
            >
              <option value="">{t('teamDuel.choosePlayer')}</option>
              {players.map((player) => (
                <option key={player.id} value={player.id} disabled={playerIds.includes(player.id) && playerId !== player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-indigo-700">{t('teamDuel.rankHelp')}</p>
      <Link to="/players" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-bold text-indigo-700 underline underline-offset-2 hover:text-indigo-900">
        {t('teamDuel.addMissingPlayer')}
      </Link>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="submit" disabled={!complete || saving} className={primaryButton}>{t('common.save')}</button>
        <button type="button" onClick={onCancel} className={secondaryButton}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}

function SquadManager({
  squads,
  players,
  events,
}: {
  squads: TeamDuelSquad[]
  players: TeamDuelRegisteredPlayer[]
  events: TeamDuelEvent[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<TeamDuelSquad | null | undefined>(undefined)
  const saveMutation = useMutation({
    mutationFn: (input: { name: string; playerIds: string[] }) => saveTeamDuelSquad({
      id: editing?.id,
      name: input.name,
      poolPlayerIds: input.playerIds,
      expectedRevision: editing?.revision,
    }),
    onSuccess: async () => {
      setEditing(undefined)
      await queryClient.invalidateQueries({ queryKey: teamDuelSquadsQueryKey })
    },
  })
  const archiveMutation = useMutation({
    mutationFn: ({ squad, archived }: { squad: TeamDuelSquad; archived: boolean }) =>
      setTeamDuelSquadArchived(squad, archived),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: teamDuelSquadsQueryKey }),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteTeamDuelSquad,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: teamDuelSquadsQueryKey }),
  })

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl font-black text-slate-950">{t('teamDuel.squads')}</h2><p className="text-sm text-slate-500">{t('teamDuel.squadsHelp')}</p></div>
        {editing === undefined ? <button type="button" onClick={() => setEditing(null)} className={primaryButton}>{t('teamDuel.newSquad')}</button> : null}
      </div>
      {editing !== undefined ? (
        <div className="mt-5">
          <SquadEditor key={editing?.id ?? 'new'} players={players} squad={editing} saving={saveMutation.isPending} onCancel={() => setEditing(undefined)} onSave={(input) => saveMutation.mutate(input)} />
          {saveMutation.error ? <div className="mt-3"><ErrorState message={(saveMutation.error as Error).message} /></div> : null}
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {squads.map((squad) => {
          const isUsed = events.some((event) =>
            event.squad_a_id === squad.id || event.squad_b_id === squad.id,
          )
          return (
          <article key={squad.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${squad.status === 'archived' ? 'border-slate-200 opacity-70' : 'border-indigo-100'}`}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-black text-slate-950">{squad.name}</h3><p className="text-xs font-bold uppercase tracking-wide text-indigo-600">{t(`teamDuel.squadStatus.${squad.status}`)}</p></div>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-800">{t('teamDuel.playerCount', { count: squad.members.length })}</span>
            </div>
            <ol className="mt-4 space-y-2">
              {squad.members.map((member) => <li key={member.rank_position} className="flex gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="font-black text-indigo-700">#{member.rank_position}</span><span className="font-semibold text-slate-800">{member.player_name}</span></li>)}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(squad)} className={secondaryButton}>{t('common.edit')}</button>
              <button type="button" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate({ squad, archived: squad.status === 'active' })} className={secondaryButton}>
                {squad.status === 'active' ? t('teamDuel.archive') : t('teamDuel.restore')}
              </button>
              {!isUsed ? (
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm(t('teamDuel.confirmDeleteSquad', { name: squad.name }))) {
                      deleteMutation.mutate(squad)
                    }
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleteMutation.isPending && deleteMutation.variables?.id === squad.id
                    ? t('teamDuel.deletingSquad')
                    : t('teamDuel.deleteSquad')}
                </button>
              ) : null}
            </div>
            {isUsed ? <p className="mt-3 text-xs font-semibold text-slate-500">{t('teamDuel.usedSquadArchiveOnly')}</p> : null}
          </article>
          )
        })}
      </div>
      {archiveMutation.error || deleteMutation.error ? (
        <div className="mt-4"><ErrorState message={((archiveMutation.error ?? deleteMutation.error) as Error).message} /></div>
      ) : null}
    </section>
  )
}

function DraftManager({ squads, events, liveEvent }: { squads: TeamDuelSquad[]; events: TeamDuelEvent[]; liveEvent?: TeamDuelEvent }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const activeSquads = squads.filter((squad) => squad.status === 'active')
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TeamDuelEvent | null>(null)
  const [title, setTitle] = useState('')
  const [eventDate, setEventDate] = useState(localDateInputValue)
  const [squadAId, setSquadAId] = useState('')
  const [squadBId, setSquadBId] = useState('')
  const [courtCount, setCourtCount] = useState(1)
  const squadA = activeSquads.find((squad) => squad.id === squadAId)
  const squadB = activeSquads.find((squad) => squad.id === squadBId)
  const squadAPlayerIds = new Set(squadA?.members.map((member) => member.pool_player_id) ?? [])
  const compatibleB = activeSquads.filter((squad) =>
    squad.id !== squadAId
    && (!squadA || squad.members.length === squadA.members.length)
    && !squad.members.some((member) => squadAPlayerIds.has(member.pool_player_id)),
  )
  const maxCourts = squadA ? Math.floor(squadA.members.length / 2) : 1
  const canSave = Boolean(eventDate && squadA && squadB && squadA.members.length === squadB.members.length)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['team-duel'] })
  }
  const resetForm = () => {
    setShowForm(false)
    setEditingEvent(null)
    setTitle('')
    setEventDate(localDateInputValue())
    setSquadAId('')
    setSquadBId('')
    setCourtCount(1)
  }
  const editDraft = (event: TeamDuelEvent) => {
    setEditingEvent(event)
    setTitle(event.title ?? '')
    setEventDate(event.event_date)
    setSquadAId(event.squad_a_id)
    setSquadBId(event.squad_b_id)
    setCourtCount(event.court_count)
    setShowForm(true)
  }
  const saveMutation = useMutation({
    mutationFn: () => saveTeamDuelDraft({
      id: editingEvent?.id,
      eventDate,
      title,
      squadAId,
      squadBId,
      courtCount,
      expectedRevision: editingEvent?.revision,
    }),
    onSuccess: async () => {
      resetForm()
      await refresh()
    },
  })
  const activateMutation = useMutation({
    mutationFn: ({ event, size }: { event: TeamDuelEvent; size: number }) => activateTeamDuelEvent(event, size),
    onSuccess: refresh,
  })
  const deleteMutation = useMutation({ mutationFn: deleteTeamDuelDraft, onSuccess: refresh })
  const drafts = events.filter((event) => event.status === 'draft')

  return (
    <section className="mt-7 rounded-3xl border border-indigo-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-black text-slate-950">{t('teamDuel.drafts')}</h2><p className="text-sm text-slate-500">{t('teamDuel.draftsHelp')}</p></div>
        <button type="button" onClick={() => { if (showForm) resetForm(); else setShowForm(true) }} className={primaryButton}>{t('teamDuel.createDuel')}</button>
      </div>
      {showForm ? (
        <form className="mt-5 grid gap-4 rounded-2xl bg-indigo-50 p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (canSave) saveMutation.mutate() }}>
          <label className="text-sm font-bold text-slate-800">{t('teamDuel.eventDate')}<input type="date" required value={eventDate} onChange={(event) => setEventDate(event.target.value)} className={`${inputClass} mt-1`} /></label>
          <label className="text-sm font-bold text-slate-800">{t('teamDuel.optionalTitle')}<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} className={`${inputClass} mt-1`} /></label>
          <label className="text-sm font-bold text-slate-800">{t('teamDuel.teamA')}<select required value={squadAId} onChange={(event) => { setSquadAId(event.target.value); setSquadBId(''); setCourtCount(1) }} className={`${inputClass} mt-1`}><option value="">{t('teamDuel.chooseSquad')}</option>{activeSquads.map((squad) => <option key={squad.id} value={squad.id}>{squad.name} ({squad.members.length})</option>)}</select></label>
          <label className="text-sm font-bold text-slate-800">{t('teamDuel.teamB')}<select required value={squadBId} onChange={(event) => setSquadBId(event.target.value)} className={`${inputClass} mt-1`}><option value="">{t('teamDuel.chooseSquad')}</option>{compatibleB.map((squad) => <option key={squad.id} value={squad.id}>{squad.name} ({squad.members.length})</option>)}</select></label>
          <label className="text-sm font-bold text-slate-800">{t('teamDuel.courts')}<select value={courtCount} onChange={(event) => setCourtCount(Number(event.target.value))} className={`${inputClass} mt-1`}>{Array.from({ length: maxCourts }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <div className="flex items-end gap-2"><button type="submit" disabled={!canSave || saveMutation.isPending} className={primaryButton}>{t('teamDuel.saveDraft')}</button><button type="button" onClick={resetForm} className={secondaryButton}>{t('common.cancel')}</button></div>
        </form>
      ) : null}
      {saveMutation.error ? <div className="mt-3"><ErrorState message={(saveMutation.error as Error).message} /></div> : null}
      <div className="mt-5 space-y-3">
        {drafts.length === 0 ? <p className="text-sm text-slate-500">{t('teamDuel.noDrafts')}</p> : drafts.map((event) => {
          const size = squads.find((squad) => squad.id === event.squad_a_id)?.members.length ?? 0
          return (
            <article key={event.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="font-black text-slate-900"><EventName event={event} squads={squads} /></h3><p className="text-sm text-slate-500">{event.event_date}</p></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(liveEvent) || size < 4 || activateMutation.isPending} onClick={() => { if (window.confirm(t('teamDuel.confirmActivate'))) activateMutation.mutate({ event, size }) }} className={primaryButton}>{t('teamDuel.activate')}</button>
                <button type="button" onClick={() => editDraft(event)} className={secondaryButton}>{t('common.edit')}</button>
                <button type="button" disabled={deleteMutation.isPending} onClick={() => { if (window.confirm(t('teamDuel.confirmDeleteDraft'))) deleteMutation.mutate(event.id) }} className={secondaryButton}>{t('common.delete')}</button>
              </div>
            </article>
          )
        })}
      </div>
      {liveEvent ? <p className="mt-3 text-xs font-semibold text-amber-700">{t('teamDuel.liveBlocksActivation')}</p> : null}
      {activateMutation.error || deleteMutation.error ? <div className="mt-3"><ErrorState message={((activateMutation.error ?? deleteMutation.error) as Error).message} /></div> : null}
    </section>
  )
}

function TeamDuelHub() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<HubTab>('current')
  const eventsQuery = useQuery({ queryKey: teamDuelEventsQueryKey(isAdmin), queryFn: () => fetchTeamDuelEvents(isAdmin) })
  const squadsQuery = useQuery({ queryKey: teamDuelSquadsQueryKey, queryFn: fetchTeamDuelSquads, enabled: isAdmin })
  const playersQuery = useQuery({ queryKey: teamDuelPlayersQueryKey, queryFn: fetchTeamDuelRegisteredPlayers, enabled: isAdmin, refetchOnWindowFocus: 'always' })
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['team-duel'] })
  }, [queryClient])
  const deleteHistoryMutation = useMutation({
    mutationFn: deleteTeamDuelHistory,
    onSuccess: refresh,
  })
  useTeamDuelRealtime(undefined, refresh)

  if (eventsQuery.isLoading || (isAdmin && (squadsQuery.isLoading || playersQuery.isLoading))) return <LoadingState />
  const error = eventsQuery.error ?? squadsQuery.error ?? playersQuery.error
  if (error) return <ErrorState message={(error as Error).message} />
  const events = eventsQuery.data ?? []
  const squads = squadsQuery.data ?? []
  const liveEvent = events.find((event) => event.status === 'active' || event.status === 'tiebreak_required')
  const history = events.filter((event) => event.status === 'completed')
  const tabs: Array<[HubTab, string]> = [["current", t('teamDuel.current')], ["history", t('teamDuel.history')]]
  if (isAdmin) tabs.push(['squads', t('teamDuel.squads')])

  return (
    <>
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-700 p-6 text-white shadow-xl sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-indigo-200">{t('teamDuel.eyebrow')}</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">{t('teamDuel.heroTitle')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-indigo-100 sm:text-base">{t('teamDuel.heroBody')}</p>
      </section>
      <nav className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border border-indigo-100 bg-white p-1.5 shadow-sm" aria-label={t('teamDuel.sections')}>
        {tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-black ${tab === value ? 'bg-indigo-600 text-white' : 'text-indigo-900 hover:bg-indigo-50'}`}>{label}</button>)}
      </nav>
      <div className="mt-5">
        {tab === 'current' ? (
          <>
            {liveEvent ? <EventCard event={liveEvent} squads={squads} /> : <div className="rounded-3xl border-2 border-dashed border-indigo-200 bg-white p-8 text-center"><h2 className="text-xl font-black text-slate-900">{t('teamDuel.noLiveTitle')}</h2><p className="mt-2 text-sm text-slate-500">{t('teamDuel.noLiveBody')}</p></div>}
            {isAdmin ? <DraftManager squads={squads} events={events} liveEvent={liveEvent} /> : null}
          </>
        ) : null}
        {tab === 'history' ? (
          <section>
            <h2 className="mb-4 text-2xl font-black text-slate-950">{t('teamDuel.history')}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {history.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  squads={squads}
                  deleting={deleteHistoryMutation.isPending && deleteHistoryMutation.variables?.id === event.id}
                  onDelete={isAdmin ? (selectedEvent) => {
                    if (window.confirm(t('teamDuel.confirmDeleteHistory'))) {
                      deleteHistoryMutation.mutate(selectedEvent)
                    }
                  } : undefined}
                />
              ))}
              {history.length === 0 ? <p className="text-sm text-slate-500">{t('teamDuel.noHistory')}</p> : null}
            </div>
            {deleteHistoryMutation.error ? (
              <div className="mt-4"><ErrorState message={(deleteHistoryMutation.error as Error).message} /></div>
            ) : null}
          </section>
        ) : null}
        {tab === 'squads' && isAdmin ? <SquadManager squads={squads} players={playersQuery.data ?? []} events={events} /> : null}
      </div>
    </>
  )
}

function playerMap(players: TeamDuelEventPlayer[]) {
  return new Map(players.map((player) => [`${player.side}:${player.rank_position}`, player.display_name]))
}

function MatchLineup({ match, names }: { match: TeamDuelMatch; names: ReadonlyMap<string, string> }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
      <div className="rounded-xl bg-indigo-50 px-3 py-3 text-center font-black text-indigo-950">{teamDuelPlayerName(names, 'a', match.team_a_rank_1)} <span className="text-indigo-400">+</span> {teamDuelPlayerName(names, 'a', match.team_a_rank_2)}</div>
      <span className="text-xs font-black uppercase text-slate-400">{t('common.vs')}</span>
      <div className="rounded-xl bg-violet-50 px-3 py-3 text-center font-black text-violet-950">{teamDuelPlayerName(names, 'b', match.team_b_rank_1)} <span className="text-violet-400">+</span> {teamDuelPlayerName(names, 'b', match.team_b_rank_2)}</div>
    </div>
  )
}

function MatchScoreForm({ saving, onSave }: { match: TeamDuelMatch; saving: boolean; onSave: (a: number, b: number) => void }) {
  const { t } = useTranslation()
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const a = Number(teamA)
    const b = Number(teamB)
    try {
      validateTeamDuelScore(a, b)
      setError(null)
      if (window.confirm(t('teamDuel.confirmScore', { a, b }))) onSave(a, b)
    } catch {
      setError(t('teamDuel.invalidScore'))
    }
  }
  return (
    <form onSubmit={submit} className="mt-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input aria-label={t('teamDuel.teamAScore')} type="number" min="0" inputMode="numeric" value={teamA} onChange={(event) => setTeamA(event.target.value)} className={`${inputClass} text-center text-xl font-black`} />
        <span className="font-black text-slate-400">–</span>
        <input aria-label={t('teamDuel.teamBScore')} type="number" min="0" inputMode="numeric" value={teamB} onChange={(event) => setTeamB(event.target.value)} className={`${inputClass} text-center text-xl font-black`} />
      </div>
      {error ? <p className="mt-2 text-xs font-bold text-red-700">{error}</p> : null}
      <button type="submit" disabled={saving || !teamA || !teamB} className={`${primaryButton} mt-3 w-full`}>{t('teamDuel.saveScore')}</button>
    </form>
  )
}

function TiebreakForm({ snapshot, onCreate, saving }: { snapshot: TeamDuelSnapshot; onCreate: (a: [number, number], b: [number, number]) => void; saving: boolean }) {
  const { t } = useTranslation()
  const bySide = (side: 'a' | 'b') => snapshot.players.filter((player) => player.side === side).toSorted((a, b) => a.rank_position - b.rank_position)
  const [aRanks, setARanks] = useState<[number, number]>([1, 2])
  const [bRanks, setBRanks] = useState<[number, number]>([1, 2])
  const selectPair = (side: 'a' | 'b', pair: [number, number], setPair: (value: [number, number]) => void) => (
    <div className="grid grid-cols-2 gap-2">
      {[0, 1].map((index) => <select key={index} value={pair[index]} onChange={(event) => { const next: [number, number] = [...pair] as [number, number]; next[index] = Number(event.target.value); setPair(next) }} className={inputClass}>{bySide(side).map((player) => <option key={player.rank_position} value={player.rank_position} disabled={pair[1 - index] === player.rank_position}>#{player.rank_position} {player.display_name}</option>)}</select>)}
    </div>
  )
  return (
    <section className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-5">
      <h2 className="text-xl font-black text-amber-950">{t('teamDuel.tiebreakTitle')}</h2><p className="mt-1 text-sm text-amber-800">{t('teamDuel.tiebreakHelp')}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <fieldset><legend className="mb-1 text-sm font-black text-indigo-950">{snapshot.event.squad_a_name}</legend>{selectPair('a', aRanks, setARanks)}</fieldset>
        <fieldset><legend className="mb-1 text-sm font-black text-violet-950">{snapshot.event.squad_b_name}</legend>{selectPair('b', bRanks, setBRanks)}</fieldset>
      </div>
      <button type="button" disabled={saving || aRanks[0] === aRanks[1] || bRanks[0] === bRanks[1]} onClick={() => onCreate(aRanks, bRanks)} className={`${primaryButton} mt-4`}>{t('teamDuel.createTiebreak')}</button>
    </section>
  )
}

function TeamDuelEventDetail({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const snapshotQuery = useQuery({ queryKey: teamDuelSnapshotQueryKey(eventId), queryFn: () => fetchTeamDuelSnapshot(eventId) })
  const refresh = useCallback(async () => { await queryClient.invalidateQueries({ queryKey: teamDuelSnapshotQueryKey(eventId) }); await queryClient.invalidateQueries({ queryKey: ['team-duel', 'events'] }) }, [eventId, queryClient])
  const connection = useTeamDuelRealtime(eventId, refresh)
  const startMutation = useMutation({ mutationFn: ({ match, court }: { match: TeamDuelMatch; court: number }) => startTeamDuelMatch(match, court), onSuccess: refresh })
  const returnMutation = useMutation({ mutationFn: returnTeamDuelMatchToQueue, onSuccess: refresh })
  const scoreMutation = useMutation({ mutationFn: ({ match, a, b }: { match: TeamDuelMatch; a: number; b: number }) => saveTeamDuelResult(match, a, b), onSuccess: refresh })
  const tiebreakMutation = useMutation({ mutationFn: ({ snapshot, a, b }: { snapshot: TeamDuelSnapshot; a: [number, number]; b: [number, number] }) => createTeamDuelTiebreak({ event: snapshot.event, teamARanks: a, teamBRanks: b }), onSuccess: refresh })

  if (snapshotQuery.isLoading) return <LoadingState />
  if (snapshotQuery.error || !snapshotQuery.data) return <ErrorState message={(snapshotQuery.error as Error | undefined)?.message ?? t('teamDuel.notFound')} />
  const snapshot = snapshotQuery.data
  const { event, players, matches } = snapshot
  const names = playerMap(players)
  const score = getTeamDuelScore(matches)
  const playing = matches.filter((match) => match.status === 'playing')
  const available = matches.filter((match) => match.status === 'available')
  const completed = matches.filter((match) => match.status === 'completed')
  const openCourts = Array.from({ length: event.court_count }, (_, index) => index + 1).filter((court) => !playing.some((match) => match.court_number === court))
  const busy = (match: TeamDuelMatch) => playing.some((active) => (
    [active.team_a_rank_1, active.team_a_rank_2].some((rank) => [match.team_a_rank_1, match.team_a_rank_2].includes(rank))
    || [active.team_b_rank_1, active.team_b_rank_2].some((rank) => [match.team_b_rank_1, match.team_b_rank_2].includes(rank))
  ))
  const error = startMutation.error ?? returnMutation.error ?? scoreMutation.error ?? tiebreakMutation.error
  const hasTiebreak = matches.some((match) => match.kind === 'tiebreak')
  const rounds = event.roster_size ? generateTeamDuelSchedule(event.roster_size) : []
  const date = formatMatchDate(event.event_date, i18n.language)

  return (
    <>
      <Link to="/team-duel" className="inline-flex min-h-11 items-center text-sm font-black text-indigo-800 hover:underline">← {t('teamDuel.backToHub')}</Link>
      <section className="mt-2 overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-700 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider text-indigo-200">{date} · {t(`teamDuel.status.${event.status}`)}</p><h1 className="mt-2 text-2xl font-black sm:text-3xl"><EventName event={event} /></h1><p className="mt-1 text-xs text-indigo-200">{t(`rotation.connection.${connection}`)}</p></div><div className="rounded-2xl bg-white/10 px-5 py-3 text-center"><p className="text-3xl font-black tabular-nums">{score.teamA}–{score.teamB}</p><p className="text-xs font-bold text-indigo-100">{t('teamDuel.teamPoints')}</p></div></div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="text-center text-lg font-black">{event.squad_a_name}</div><span className="text-xs font-black text-indigo-200">{t('common.vs')}</span><div className="text-center text-lg font-black">{event.squad_b_name}</div></div>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2">
        {(['a', 'b'] as const).map((side) => <article key={side} className="rounded-3xl border border-indigo-100 bg-white p-5 shadow-sm"><h2 className={`text-lg font-black ${side === 'a' ? 'text-indigo-950' : 'text-violet-950'}`}>{side === 'a' ? event.squad_a_name : event.squad_b_name}</h2><ol className="mt-3 grid gap-2 sm:grid-cols-2">{players.filter((player) => player.side === side).toSorted((a, b) => a.rank_position - b.rank_position).map((player) => <li key={player.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="mr-2 font-black text-indigo-700">#{player.rank_position}</span><span className="font-semibold">{player.display_name}</span></li>)}</ol></article>)}
      </section>

      {event.status !== 'completed' ? (
        <section className="mt-5">
          <h2 className="text-2xl font-black text-slate-950">{t('teamDuel.liveCourts')}</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">{Array.from({ length: event.court_count }, (_, index) => index + 1).map((court) => { const match = playing.find((item) => item.court_number === court); return <article key={court} className={`min-h-56 rounded-3xl p-5 ${match ? 'bg-indigo-900 text-white shadow-lg' : 'border-2 border-dashed border-indigo-200 bg-white'}`}><h3 className={`text-sm font-black uppercase tracking-wider ${match ? 'text-indigo-100' : 'text-indigo-800'}`}>{t('teamDuel.courtNumber', { number: court })}</h3>{match ? <><div className="mt-4 rounded-2xl bg-white p-3"><MatchLineup match={match} names={names} /></div>{isAdmin ? <><MatchScoreForm key={match.id} match={match} saving={scoreMutation.isPending} onSave={(a, b) => scoreMutation.mutate({ match, a, b })} /><button type="button" disabled={returnMutation.isPending} onClick={() => returnMutation.mutate(match)} className="mt-2 w-full text-xs font-bold text-indigo-100 underline">{t('teamDuel.returnQueue')}</button></> : null}</> : <div className="flex min-h-40 items-center justify-center text-sm text-slate-400">{t('teamDuel.courtOpen')}</div>}</article> })}</div>
        </section>
      ) : null}

      {available.length > 0 ? <section className="mt-6 rounded-3xl border border-indigo-100 bg-white p-5 shadow-sm"><h2 className="text-2xl font-black text-slate-950">{t('teamDuel.queue')}</h2><div className="mt-4 space-y-4">{available.map((match) => { const blocked = busy(match); const bye = match.kind === 'standard' ? rounds[match.round_number - 1]?.byeRank : null; return <article key={match.id} className="rounded-2xl border border-slate-200 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-black uppercase tracking-wider text-slate-500">{match.kind === 'tiebreak' ? t('teamDuel.tiebreak') : t('teamDuel.roundMatch', { round: match.round_number, match: match.sequence_number })}</span>{bye ? <span className="text-xs font-bold text-slate-500">{t('teamDuel.mirroredRest', { rank: bye })}</span> : null}</div><MatchLineup match={match} names={names} />{isAdmin ? <div className="mt-3 flex flex-wrap gap-2">{openCourts.map((court) => <button key={court} type="button" disabled={blocked || startMutation.isPending} onClick={() => startMutation.mutate({ match, court })} className={secondaryButton}>{t('teamDuel.startCourt', { court })}</button>)}{blocked ? <span className="self-center text-xs font-bold text-amber-700">{t('teamDuel.playersBusy')}</span> : null}</div> : null}</article>})}</div></section> : null}

      {event.status === 'tiebreak_required' && !hasTiebreak && isAdmin ? <TiebreakForm snapshot={snapshot} saving={tiebreakMutation.isPending} onCreate={(a, b) => tiebreakMutation.mutate({ snapshot, a, b })} /> : null}
      {event.status === 'tiebreak_required' && !hasTiebreak && !isAdmin ? <div className="mt-6 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-center font-bold text-amber-900">{t('teamDuel.awaitingTiebreak')}</div> : null}

      {completed.length > 0 ? <details className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" open={event.status === 'completed'}><summary className="cursor-pointer text-xl font-black text-slate-950">{t('teamDuel.completedMatches', { count: completed.length })}</summary><div className="mt-4 space-y-3">{completed.map((match) => <article key={match.id} className="rounded-2xl bg-slate-50 p-4"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-slate-500">{match.kind === 'tiebreak' ? t('teamDuel.tiebreak') : t('teamDuel.roundLabel', { round: match.round_number })}</span><span className="text-lg font-black tabular-nums">{match.team_a_score}–{match.team_b_score}</span></div><MatchLineup match={match} names={names} /></article>)}</div></details> : null}
      {error ? <div className="mt-5"><ErrorState message={(error as Error).message} /></div> : null}
    </>
  )
}

export function TeamDuelPage() {
  const { eventId } = useParams<{ eventId: string }>()
  return <TeamDuelShell>{eventId ? <TeamDuelEventDetail eventId={eventId} /> : <TeamDuelHub />}</TeamDuelShell>
}
