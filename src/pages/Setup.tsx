import { Select } from '../components/Select'
import { useConfirm } from '../lib/confirmation'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveSeason,
  createManyTeamsWithPlayers,
  createPoolPlayer,
  createSeason,
  createTeamWithPlayers,
  deleteAllSeasonTeams,
  deletePoolPlayer,
  deleteSeasonTeam,
  fetchAssignedPoolPlayerIds,
  fetchMatches,
  fetchPartnershipCounts,
  saveTeamWithPlayers,
  updatePoolPlayer,
  updatePoolPlayerStatus,
} from '../lib/api'
import type { BalancedTeam } from '../lib/balanceTeams'
import { roundRating } from '../lib/ratings'
import { ArchivedSeasonBanner } from '../components/ArchivedSeasonBanner'
import { BalancedTeamsBuilder } from '../components/BalancedTeamsBuilder'
import { LeagueTeamDuelSetup } from '../components/LeagueTeamDuelSetup'
import { PicklePrizeSettings, PickleDistribution } from '../components/PicklePrizeSettings'
import { fetchPicklePreview } from '../lib/picklePointsApi'
import { formatPicklePoints } from '../lib/picklePoints'
import { usePicklePreview } from '../hooks/usePicklePoints'
import { SeasonFormatSelector } from '../components/SeasonFormatSelector'
import { PlayerAccountLinks } from '../components/PlayerAccountLinks'
import { SetupWorkspace } from '../components/SetupWorkspace'
import { SetupSeasonOverview } from '../components/SetupSeasonOverview'
import { resolveSetupSection, type SetupSection } from '../lib/setupWorkspace'
import { useMatches } from '../hooks/useMatches'
import { useAuth } from '../context/AuthContext'
import { betErrorMessage, fetchBets } from '../lib/betsApi'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { useSeason } from '../context/SeasonContext'
import { useLeague } from '../context/LeagueContext'
import {
  addExistingPlayerToLeague,
  fetchSharedPlayerIdentities,
  updateLeagueBranding,
  updateLeagueStatus,
} from '../lib/leagueApi'
import { fetchSeasonRosterIds, saveSeasonRoster, seasonRosterQueryKey } from '../lib/seasonRosterApi'
import { useAssignedPoolPlayerIds, usePlayerPool } from '../hooks/usePlayerPool'
import { useTeamsWithPlayers } from '../hooks/useTeams'
import type { PoolPlayer, SeasonFormat, TeamWithPlayers } from '../types'

type PoolStatusFilter = 'active' | 'inactive' | 'all'

const TEAM_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
]

const EMPTY_PARTNERSHIP_COUNTS = new Map<string, number>()

function pickNextTeamColor(usedColors: string[]): string {
  const used = new Set(usedColors)
  const next = TEAM_COLORS.find((color) => !used.has(color))
  if (next) return next
  return TEAM_COLORS[usedColors.length % TEAM_COLORS.length]
}

const selectClass =
  'min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base sm:text-sm'

function LeagueBrandingForm() {
  const confirm = useConfirm()
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { league } = useLeague()
  const [name, setName] = useState(league.name)
  const [logoFile, setLogoFile] = useState<File | null>(null)

  useEffect(() => setName(league.name), [league.name])

  const mutation = useMutation({
    mutationFn: () => updateLeagueBranding(league.id, name, logoFile),
    onSuccess: async () => {
      setLogoFile(null)
      await queryClient.invalidateQueries({ queryKey: ['leagues'] })
    },
  })
  const statusMutation = useMutation({
    mutationFn: () => updateLeagueStatus(
      league.id,
      league.status === 'active' ? 'archived' : 'active',
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leagues'] })
    },
  })

  return (
    <section className="mb-6 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-green-900">{t('workspace.leagueIdentity')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('leagueSettings.description')}</p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-800">
            {t('leagueSettings.name')}
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3" required />
          </label>
          <label className="block text-sm font-semibold text-gray-800">
            {t('leagueSettings.logo')}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
          </label>
        </div>
        <button type="submit" disabled={mutation.isPending || !name.trim()} className="min-h-11 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {mutation.isPending ? t('leagueSettings.saving') : t('common.save')}
        </button>
      </form>
      {mutation.isSuccess ? <p className="mt-3 text-sm text-green-700" role="status">{t('leagueSettings.saved')}</p> : null}
      {mutation.error ? <p className="mt-3 text-sm text-red-700" role="alert">{(mutation.error as Error).message}</p> : null}
      <details className="mt-5 border-t border-gray-100 pt-4">
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-green-900">{t('workspace.advancedLeague')}</summary>
        <p className="text-sm text-gray-600">
          {league.status === 'active' ? t('leagueSettings.archiveHint') : t('leagueSettings.restoreHint')}
        </p>
        <button
          type="button"
          disabled={statusMutation.isPending}
          onClick={async () => {
            const key = league.status === 'active' ? 'archiveConfirm' : 'restoreConfirm'
            if (await confirm(t(`leagueSettings.${key}`, { name: league.name }))) statusMutation.mutate()
          }}
          className="mt-3 min-h-11 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 disabled:opacity-50"
        >
          {league.status === 'active' ? t('leagueSettings.archive') : t('leagueSettings.restore')}
        </button>
        {statusMutation.error ? <p className="mt-3 text-sm text-red-700" role="alert">{(statusMutation.error as Error).message}</p> : null}
      </details>
    </section>
  )
}

function poolOptionsForSlot(
  pool: PoolPlayer[],
  assignedIds: Set<string>,
  seasonRosterIds: Set<string>,
  teamPoolIds: Set<string>,
  slotValue: string,
  otherSlotValue: string,
) {
  return pool.filter((player) => {
    if (player.id === slotValue || player.id === otherSlotValue) return true
    if (teamPoolIds.has(player.id)) return true
    if (player.status !== 'active') return false
    if (!seasonRosterIds.has(player.id)) return false
    return !assignedIds.has(player.id)
  })
}

function PoolPlayerRow({
  player,
  isAssigned,
  isOnActiveSeasonTeam,
  isSaving,
  isStatusSaving,
  onSave,
  onDelete,
  onToggleStatus,
}: {
  player: PoolPlayer
  isAssigned: boolean
  isOnActiveSeasonTeam: boolean
  isSaving: boolean
  isStatusSaving: boolean
  onSave: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  onToggleStatus: (id: string, status: 'active' | 'inactive') => void
}) {
  const { t } = useTranslation()
  const { leaguePath } = useLeague()
  const [name, setName] = useState(player.name)

  useEffect(() => {
    setName(player.name)
  }, [player.name])

  const trimmed = name.trim()
  const isDirty = trimmed !== player.name
  const isActive = player.status === 'active'
  const cannotDeactivate = isActive && isOnActiveSeasonTeam

  return (
    <li
      className={`rounded-lg border ${
        isActive
          ? 'border-emerald-200 bg-emerald-50/70'
          : 'border-slate-200 bg-slate-50'
      }`}
    >
      <details>
        <summary className="flex min-h-14 cursor-pointer flex-wrap items-center gap-2 px-3 py-3">
          <span className="w-full min-w-0 break-words font-semibold text-gray-900 sm:w-auto sm:flex-1">{player.name}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'}`}>
            {isActive ? t('pool.statusActive') : t('pool.statusInactive')}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isAssigned ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
            {isAssigned ? t('pool.assigned') : t('pool.available')}
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-green-100 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-medium text-gray-700">
            {t('pool.playerNameLabel', { name: player.name })}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base sm:text-sm"
            />
          </label>
          <Link to={leaguePath(`/players/${player.id}`)} className="inline-flex min-h-11 items-center rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-50">
            {t('pool.ratingBadge', { rating: roundRating(player.rating) })}
          </Link>
          <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          onClick={() =>
            onToggleStatus(player.id, isActive ? 'inactive' : 'active')
          }
          disabled={isStatusSaving || cannotDeactivate}
          title={cannotDeactivate ? t('pool.cannotDeactivateOnTeam') : undefined}
          className={`min-h-11 rounded-lg border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50 ${
            isActive
              ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
              : 'border-emerald-300 text-emerald-800 hover:bg-emerald-100'
          }`}
        >
          {isStatusSaving
            ? t('pool.saving')
            : isActive
              ? t('pool.setInactive')
              : t('pool.setActive')}
        </button>
        {cannotDeactivate ? (
          <p className="max-w-[14rem] text-[11px] leading-snug text-amber-800">
            {t('pool.cannotDeactivateOnTeam')}
          </p>
        ) : null}
          </div>
      <button
        type="button"
        onClick={() => onSave(player.id, trimmed)}
        disabled={isSaving || !trimmed || !isDirty}
        className="min-h-11 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50"
      >
        {isSaving ? t('pool.saving') : t('common.save')}
      </button>
      <button
        type="button"
        onClick={() => onDelete(player.id, player.name)}
        disabled={isSaving || isStatusSaving}
        className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {t('pool.deleteButton')}
      </button>
        </div>
      </details>
    </li>
  )
}

function TeamEditForm({
  team,
  seasonId,
  pool,
  assignedIds,
  seasonRosterIds,
  onSaved,
  onDeleted,
  onError,
}: {
  team: TeamWithPlayers
  seasonId: string
  pool: PoolPlayer[]
  assignedIds: Set<string>
  seasonRosterIds: Set<string>
  onSaved: (message: string) => void
  onDeleted: (message: string) => void
  onError: (message: string) => void
}) {
  const confirm = useConfirm()
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const teamPoolIds = useMemo(
    () => new Set(team.players.map((player) => player.pool_player_id)),
    [team.players],
  )
  const [teamName, setTeamName] = useState(team.name)
  const [poolPlayerIds, setPoolPlayerIds] = useState<[string, string]>([
    team.players[0]?.pool_player_id ?? '',
    team.players[1]?.pool_player_id ?? '',
  ])

  const saveMutation = useMutation({
    mutationFn: () =>
      saveTeamWithPlayers(
        seasonId,
        team.id,
        teamName,
        team.players.map((player, index) => ({
          id: player.id,
          poolPlayerId: poolPlayerIds[index],
        })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['teams-with-players'] })
      queryClient.invalidateQueries({ queryKey: ['assigned-pool-players'] })
      onSaved(t('setup.teamUpdated'))
    },
    onError: (err: Error) => onError(t('setup.saveFailed', { message: err.message })),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSeasonTeam(seasonId, team.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['teams-with-players'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      queryClient.invalidateQueries({ queryKey: ['assigned-pool-players'] })
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      onDeleted(t('setup.deleteTeamSuccess', { name: team.name }))
    },
    onError: (err: Error) => {
      if (err.message.includes('results have been recorded')) {
        onError(t('setup.deleteTeamBlocked'))
        return
      }
      if (err.message.includes('match in progress')) {
        onError(t('setup.deleteTeamPlaying'))
        return
      }
      onError(t('setup.deleteTeamFailed', { message: err.message }))
    },
  })

  const slot1Options = poolOptionsForSlot(
    pool,
    assignedIds,
    seasonRosterIds,
    teamPoolIds,
    poolPlayerIds[0],
    poolPlayerIds[1],
  )
  const slot2Options = poolOptionsForSlot(
    pool,
    assignedIds,
    seasonRosterIds,
    teamPoolIds,
    poolPlayerIds[1],
    poolPlayerIds[0],
  )

  return (
    <form
      className="rounded-xl border border-green-200 bg-white p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault()
        saveMutation.mutate()
      }}
    >
      <input
        value={teamName}
        aria-label={t('setup.teamNameLabel')}
        onChange={(e) => setTeamName(e.target.value)}
        className="mb-4 min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base font-medium sm:text-sm"
        required
      />

      <div className="space-y-2">
        <Select
          value={poolPlayerIds[0]}
          onValueChange={(value) =>
            setPoolPlayerIds(([_, second]) => [value, second])
          }
          className={selectClass}
          aria-label={t('setup.pickPlayer1')}
          required
        >
          <option value="">{t('setup.pickPlayer1')}</option>
          {slot1Options.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </Select>
        <Select
          value={poolPlayerIds[1]}
          onValueChange={(value) =>
            setPoolPlayerIds(([first]) => [first, value])
          }
          className={selectClass}
          aria-label={t('setup.pickPlayer2')}
          required
        >
          <option value="">{t('setup.pickPlayer2')}</option>
          {slot2Options.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <button
          type="submit"
          disabled={
            saveMutation.isPending ||
            deleteMutation.isPending ||
            !poolPlayerIds[0] ||
            !poolPlayerIds[1] ||
            poolPlayerIds[0] === poolPlayerIds[1]
          }
          className="min-h-11 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2"
        >
          {saveMutation.isPending ? t('setup.savingTeam') : t('setup.saveTeam')}
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending || deleteMutation.isPending}
          onClick={async () => {
            if (await confirm(t('setup.deleteTeamConfirm', { name: team.name }), { tone: 'danger' })) {
              deleteMutation.mutate()
            }
          }}
          className="min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 active:bg-red-100 disabled:opacity-50"
        >
          {deleteMutation.isPending
            ? t('setup.deleteTeamWorking')
            : t('setup.deleteTeamButton')}
        </button>
      </div>
    </form>
  )
}

export function SetupPage() {
  const confirm = useConfirm()
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { league, leaguePath } = useLeague()
  const { user } = useAuth()
  const { selectedSeason, activeSeason, isSelectedSeasonActive, setSelectedSeasonId, isLoading: seasonsLoading, isError: seasonsError, error: seasonsQueryError } =
    useSeason()
  const { data: teams, isError, error, refetch: refetchTeams } = useTeamsWithPlayers()
  const selectedMatchesQuery = useMatches()
  const selectedMatches = selectedMatchesQuery.data
  const { data: pool = [], isError: poolError, error: poolQueryError, refetch: refetchPool } = usePlayerPool()
  const { data: assignedPoolIds = [] } = useAssignedPoolPlayerIds()
  const seasonRosterQuery = useQuery({
    queryKey: seasonRosterQueryKey(selectedSeason?.id),
    queryFn: () => fetchSeasonRosterIds(selectedSeason!.id),
    enabled: !!selectedSeason,
  })
  const {
    data: sharedPlayerIdentities = [],
    isLoading: sharedPlayersLoading,
    isError: sharedPlayersError,
  } = useQuery({
    queryKey: ['shared-player-identities'],
    queryFn: fetchSharedPlayerIdentities,
  })
  const {
    data: partnershipCounts = EMPTY_PARTNERSHIP_COUNTS,
    isLoading: isPartnershipHistoryLoading,
  } = useQuery({
    queryKey: ['partnership-counts', league.id],
    queryFn: () => fetchPartnershipCounts(league.id),
  })
  const { data: activeSeasonAssignedIds = [] } = useQuery({
    queryKey: ['assigned-pool-players', activeSeason?.id],
    queryFn: () => fetchAssignedPoolPlayerIds(activeSeason!.id),
    enabled: !!activeSeason,
  })
  const { data: activeSeasonMatches } = useQuery({
    queryKey: ['matches', activeSeason?.id, league.id],
    queryFn: () => fetchMatches(activeSeason!.id, league.id),
    enabled: !!activeSeason,
  })
  const [feedback, setFeedback] = useState<{
    text: string
    tone: 'ok' | 'error'
  } | null>(null)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [newSeasonFormat, setNewSeasonFormat] = useState<SeasonFormat>('round_robin')
  const isDuel = selectedSeason?.format === 'team_duel'
  const archivePreview = usePicklePreview(activeSeason?.format === 'team_duel' ? activeSeason.id : undefined)
  const [preparingArchive, setPreparingArchive] = useState(false)
  const duelRosterLocked = isDuel && (!selectedMatches || selectedMatches.length > 0)
  const rosterReadOnly = !isSelectedSeasonActive || duelRosterLocked
  const activeSection = resolveSetupSection(searchParams.get('section'))
  const selectedPreview = usePicklePreview(isDuel ? selectedSeason?.id : undefined)
  const seasonBets = useQuery({
    queryKey: ['bets', 'setup-review', league.id, user?.id],
    queryFn: () => fetchBets(league.id),
    enabled: activeSection === 'finish' && !!user && isSelectedSeasonActive,
    refetchOnWindowFocus: 'always',
  })
  const unsettledBetCount = seasonBets.data?.filter(bet => bet.seasonId === selectedSeason?.id && (bet.state === 'accepted' || bet.state === 'review')).length
  const [showAddPlayer, setShowAddPlayer] = useState(false)
  const [showNewSeason, setShowNewSeason] = useState(false)
  function navigateSection(section: SetupSection) {
    setFeedback(null)
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('section', section)
      return next
    })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const [newPoolName, setNewPoolName] = useState('')
  const [newPoolRating, setNewPoolRating] = useState('1500')
  const [existingPoolPlayerId, setExistingPoolPlayerId] = useState('')
  const [existingPoolRating, setExistingPoolRating] = useState('1500')
  const [addPlayerMode, setAddPlayerMode] = useState<'existing' | 'new'>('existing')
  const [poolStatusFilter, setPoolStatusFilter] = useState<PoolStatusFilter>('active')
  const [poolSearch, setPoolSearch] = useState('')
  const [seasonRosterDraft, setSeasonRosterDraft] = useState<string[]>([])
  const [newTeam, setNewTeam] = useState({
    name: '',
    poolPlayerId1: '',
    poolPlayerId2: '',
  })

  const assignedIds = useMemo(() => new Set(assignedPoolIds), [assignedPoolIds])
  const seasonRosterIds = useMemo(
    () => new Set(seasonRosterQuery.data ?? []),
    [seasonRosterQuery.data],
  )
  const draftRosterIds = useMemo(() => new Set(seasonRosterDraft), [seasonRosterDraft])
  const seasonRosterDirty = seasonRosterDraft.length !== seasonRosterIds.size
    || seasonRosterDraft.some((id) => !seasonRosterIds.has(id))

  useEffect(() => {
    setSeasonRosterDraft(seasonRosterQuery.data ?? [])
  }, [seasonRosterQuery.data, selectedSeason?.id])
  const activeSeasonAssigned = useMemo(
    () => new Set(activeSeasonAssignedIds),
    [activeSeasonAssignedIds],
  )
  const activeUnassigned = useMemo(
    () =>
      pool.filter(
        (player) => player.status === 'active'
          && seasonRosterIds.has(player.id)
          && !assignedIds.has(player.id),
      ),
    [pool, assignedIds, seasonRosterIds],
  )
  const activeCount = useMemo(
    () => pool.filter((player) => player.status === 'active').length,
    [pool],
  )
  const inactiveCount = pool.length - activeCount
  const visiblePool = useMemo(() => {
    const query = poolSearch.trim().toLocaleLowerCase()
    return pool.filter((player) => {
      if (poolStatusFilter !== 'all' && player.status !== poolStatusFilter) return false
      return !query || player.name.toLocaleLowerCase().includes(query)
    })
  }, [pool, poolSearch, poolStatusFilter])
  const availableSharedPlayers = useMemo(() => {
    const leaguePlayerIds = new Set(pool.map((player) => player.id))
    return sharedPlayerIdentities.filter((player) => !leaguePlayerIds.has(player.id))
  }, [pool, sharedPlayerIdentities])
  const recordedCount = (activeSeasonMatches ?? []).filter(
    (m) => m.status === 'completed' || m.status === 'forfeit',
  ).length

  function invalidateSeasonData() {
    queryClient.invalidateQueries({ queryKey: ['seasons'] })
    queryClient.invalidateQueries({ queryKey: ['teams'] })
    queryClient.invalidateQueries({ queryKey: ['teams-with-players'] })
    queryClient.invalidateQueries({ queryKey: ['matches'] })
    queryClient.invalidateQueries({ queryKey: ['assigned-pool-players'] })
    queryClient.invalidateQueries({ queryKey: ['season-roster'] })
  }

  const addPoolMutation = useMutation({
    mutationFn: ({ name, rating }: { name: string; rating: number }) =>
      createPoolPlayer(league.id, name, rating),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setNewPoolName('')
      setNewPoolRating('1500')
      setShowAddPlayer(false)
      setFeedback({ text: t('pool.added'), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({
        text: t('pool.saveFailed', { message: err.message }),
        tone: 'error',
      }),
  })

  const addExistingPoolMutation = useMutation({
    mutationFn: ({ playerId, rating }: { playerId: string; rating: number }) =>
      addExistingPlayerToLeague(league.id, playerId, rating),
    onSuccess: (_data, variables) => {
      const playerName = sharedPlayerIdentities.find(
        (player) => player.id === variables.playerId,
      )?.name
      queryClient.invalidateQueries({ queryKey: ['player-pool', league.id] })
      queryClient.invalidateQueries({ queryKey: ['shared-player-identities'] })
      setExistingPoolPlayerId('')
      setExistingPoolRating('1500')
      setShowAddPlayer(false)
      setFeedback({
        text: t('pool.addedExisting', { name: playerName ?? t('pool.existingPlayer') }),
        tone: 'ok',
      })
    },
    onError: (err: Error) =>
      setFeedback({
        text: t('pool.saveFailed', { message: err.message }),
        tone: 'error',
      }),
  })

  const updatePoolMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updatePoolPlayer(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setFeedback({ text: t('pool.updated'), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({
        text: t('pool.saveFailed', { message: err.message }),
        tone: 'error',
      }),
  })

  const updatePoolStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string
      status: 'active' | 'inactive'
    }) => updatePoolPlayerStatus(league.id, id, status),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setFeedback({
        text:
          variables.status === 'active'
            ? t('pool.statusSetActive')
            : t('pool.statusSetInactive'),
        tone: 'ok',
      })
    },
    onError: (err: Error) => {
      if (err.message.includes('cannot be set inactive')) {
        setFeedback({ text: t('pool.cannotDeactivateOnTeam'), tone: 'error' })
        return
      }
      setFeedback({
        text: t('pool.saveFailed', { message: err.message }),
        tone: 'error',
      })
    },
  })

  const deletePoolMutation = useMutation({
    mutationFn: (id: string) => deletePoolPlayer(league.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setFeedback({ text: t('pool.deleted'), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({
        text: t('pool.deleteFailed', { message: err.message }),
        tone: 'error',
      }),
  })

  const archiveMutation = useMutation({
    mutationFn: ({ seasonId, fingerprint }: { seasonId: string; fingerprint?: string }) => archiveSeason(seasonId, fingerprint),
    onSuccess: (season) => {
      invalidateSeasonData()
      void queryClient.invalidateQueries({ queryKey: ['pickle-points'] })
      void queryClient.invalidateQueries({ queryKey: ['pickle-preview'] })
      setSelectedSeasonId(season.id)
      setFeedback({ text: t('setup.archiveSuccess', { name: season.name }), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({ text: t('setup.archiveFailed', { message: err.message }), tone: 'error' }),
  })

  const createSeasonMutation = useMutation({
    mutationFn: (name: string) => createSeason(name, league.id, newSeasonFormat),
    onSuccess: (season) => {
      invalidateSeasonData()
      setSelectedSeasonId(season.id)
      setNewSeasonName('')
      setShowNewSeason(false)
      navigateSection('roster')
      setFeedback({ text: t('setup.newSeasonSuccess', { name: season.name }), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({ text: t('setup.newSeasonFailed', { message: err.message }), tone: 'error' }),
  })

  const seasonRosterMutation = useMutation({
    mutationFn: (playerIds: string[]) => saveSeasonRoster(selectedSeason!.id, playerIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seasonRosterQueryKey(selectedSeason?.id) })
      invalidateSeasonData()
      queryClient.invalidateQueries({ queryKey: ['league-duel-draft'] })
      setFeedback({ text: t('setup.seasonRosterSaved'), tone: 'ok' })
    },
  })

  const createTeamMutation = useMutation({
    mutationFn: (payload: {
      name: string
      color: string
      poolPlayerIds: [string, string]
    }) => createTeamWithPlayers(selectedSeason!.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['teams-with-players'] })
      queryClient.invalidateQueries({ queryKey: ['assigned-pool-players'] })
      setNewTeam({ name: '', poolPlayerId1: '', poolPlayerId2: '' })
      setFeedback({ text: t('setup.teamCreated'), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({
        text: t('setup.createTeamFailed', { message: err.message }),
        tone: 'error',
      }),
  })

  const balanceTeamsMutation = useMutation({
    mutationFn: (payload: {
      name: string
      color: string
      poolPlayerIds: [string, string]
    }[]) => createManyTeamsWithPlayers(selectedSeason!.id, payload),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['teams-with-players'] })
      queryClient.invalidateQueries({ queryKey: ['assigned-pool-players'] })
      setFeedback({ text: t('setup.balancedTeamsCreated', { count }), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({
        text: t('setup.balancedTeamsFailed', { message: err.message }),
        tone: 'error',
      }),
  })

  const deleteTeamsMutation = useMutation({
    mutationFn: () => deleteAllSeasonTeams(selectedSeason!.id),
    onSuccess: () => {
      invalidateSeasonData()
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setFeedback({ text: t('setup.deleteTeamsSuccess'), tone: 'ok' })
    },
    onError: (err: Error) => {
      if (err.message.includes('results have been recorded')) {
        setFeedback({ text: t('setup.deleteTeamsBlocked'), tone: 'error' })
        return
      }
      setFeedback({
        text: t('setup.deleteTeamsFailed', { message: err.message }),
        tone: 'error',
      })
    },
  })

  async function handleArchiveSeason() {
    if (!activeSeason || preparingArchive || archiveMutation.isPending) return
    setPreparingArchive(true)
    try {
      let fingerprint: string | undefined
      let message = t('setup.archiveConfirm', { name: activeSeason.name, count: recordedCount })
      if (activeSeason.format === 'team_duel') {
        const preview = await fetchPicklePreview(activeSeason.id)
        queryClient.setQueryData(['pickle-preview', activeSeason.id], preview)
        if (!preview.configured || !preview.complete || preview.squads.length !== 2) {
          setFeedback({ text: t('pickle.notReady'), tone: 'error' })
          return
        }
        fingerprint = preview.fingerprint
        message = [message, ...preview.squads.map((squad) => `${squad.name}: ${formatPicklePoints(squad.total)} · ${t('pickle.each')}: ${squad.share === null ? '—' : formatPicklePoints(squad.share)}`), t('pickle.archiveWarning')].join('\n\n')
      }
      if (await confirm(message)) archiveMutation.mutate({ seasonId: activeSeason.id, fingerprint })
    } catch (err) {
      setFeedback({ text: t('setup.archiveFailed', { message: (err as Error).message }), tone: 'error' })
    } finally {
      setPreparingArchive(false)
    }
  }

  async function handleStartNewSeason(e: React.FormEvent) {
    e.preventDefault()
    const name = newSeasonName.trim()
    if (!name) return
    if (!await confirm(t('setup.newSeasonConfirm', { name }))) return
    createSeasonMutation.mutate(name)
  }

  function handleAddPoolPlayer(e: React.FormEvent) {
    e.preventDefault()
    const name = newPoolName.trim()
    if (!name) return
    const rating = Number(newPoolRating)
    if (!Number.isFinite(rating) || rating < 800 || rating > 2500) {
      setFeedback({ text: t('pool.ratingInvalid'), tone: 'error' })
      return
    }
    addPoolMutation.mutate({ name, rating })
  }

  function handleAddExistingPoolPlayer(e: React.FormEvent) {
    e.preventDefault()
    if (!existingPoolPlayerId) return
    const rating = Number(existingPoolRating)
    if (!Number.isFinite(rating) || rating < 800 || rating > 2500) {
      setFeedback({ text: t('pool.ratingInvalid'), tone: 'error' })
      return
    }
    addExistingPoolMutation.mutate({ playerId: existingPoolPlayerId, rating })
  }

  function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSeason) return
    if (!activeUnassigned.some((player) => player.id === newTeam.poolPlayerId1)
      || !activeUnassigned.some((player) => player.id === newTeam.poolPlayerId2)) {
      setFeedback({ text: t('setup.seasonRosterSelectionChanged'), tone: 'error' })
      return
    }
    createTeamMutation.mutate({
      name: newTeam.name.trim(),
      color: pickNextTeamColor((teams ?? []).map((team) => team.color)),
      poolPlayerIds: [newTeam.poolPlayerId1, newTeam.poolPlayerId2],
    })
  }

  function handleCreateBalancedTeams(balanced: BalancedTeam[]) {
    if (!selectedSeason) return

    const usedColors = (teams ?? []).map((team) => team.color)
    const payloads = balanced.map((team) => {
      const color = pickNextTeamColor(usedColors)
      usedColors.push(color)
      return {
        name: `${team.playerNames[0]} / ${team.playerNames[1]}`,
        color,
        poolPlayerIds: team.poolPlayerIds,
      }
    })

    balanceTeamsMutation.mutate(payloads)
  }

  async function handleDeleteAllTeams() {
    if (!selectedSeason) return
    if ((recordedCount ?? 0) > 0) {
      setFeedback({ text: t('setup.deleteTeamsBlocked'), tone: 'error' })
      return
    }
    if (!await confirm(t('setup.deleteTeamsConfirm'), { tone: 'danger' })) return
    deleteTeamsMutation.mutate()
  }

  async function handleDeletePoolPlayer(id: string, name: string) {
    if (!await confirm(t('pool.deleteConfirm', { name }), { tone: 'danger' })) return
    deletePoolMutation.mutate(id)
  }

  const createSlot1Options = activeUnassigned.filter(
    (player) => player.id !== newTeam.poolPlayerId2,
  )
  const createSlot2Options = activeUnassigned.filter(
    (player) => player.id !== newTeam.poolPlayerId1,
  )

  const sectionError = ['overview', 'roster', 'teams', 'prizes', 'finish'].includes(activeSection) && seasonsError ? seasonsQueryError
    : ['overview', 'teams'].includes(activeSection) && isError ? error
    : ['overview', 'roster', 'teams', 'members'].includes(activeSection) && poolError ? poolQueryError : null

  if (league.status === 'archived') {
    const archivedSection = activeSection === 'prizes' && isDuel ? 'prizes' : 'settings'
    return (
      <SetupWorkspace section={archivedSection} onSectionChange={navigateSection} season={selectedSeason} leagueName={league.name} archivedLeague>
        <PageHeader title={t(`workspace.titles.${archivedSection}`)} subtitle={t(`workspace.descriptions.${archivedSection}`)} />
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t('leagueSettings.archivedReadOnly')}
        </p>
        <div className="mt-5">{archivedSection === 'settings' ? <><LeagueBrandingForm /><PicklePrizeSettings scope="league" /></> : <PicklePrizeSettings scope="season" />}</div>
      </SetupWorkspace>
    )
  }

  return (
    <div>
      <SetupBanner />
      <SetupWorkspace section={activeSection} onSectionChange={navigateSection} season={selectedSeason} leagueName={league.name}>
      <ArchivedSeasonBanner />
      <PageHeader
        title={t(`workspace.titles.${activeSection}`)}
        subtitle={t(`workspace.descriptions.${activeSection}`)}
      />

      {!seasonsLoading && !selectedSeason && !['overview', 'members', 'accounts', 'settings'].includes(activeSection) ? <div className="mb-5 rounded-lg border border-green-200 bg-white p-4 text-sm text-gray-600">
        <p>{t('workspace.noSeason')}</p><button type="button" onClick={() => navigateSection('overview')} className="mt-2 min-h-11 font-semibold text-green-800 underline">{t('workspace.sections.overview')}</button>
      </div> : null}

      {feedback && (
        <p
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            feedback.tone === 'error'
              ? 'border border-red-200 bg-red-50 text-red-800'
              : 'bg-green-100 text-green-800'
          }`}
        >
          {feedback.text}
        </p>
      )}

      {sectionError ? <><ErrorState message={(sectionError as Error).message} /><button type="button" onClick={() => { void queryClient.invalidateQueries({ queryKey: ['seasons', league.id] }); void refetchTeams(); void refetchPool() }} className="mt-3 min-h-11 font-semibold text-green-800 underline">{t('workspace.retry')}</button></> : <>
      {seasonsLoading && ['overview', 'roster', 'teams', 'prizes', 'finish'].includes(activeSection) ? <p role="status" className="mb-5 text-sm text-gray-600">{t('common.loading')}</p> : null}
      {activeSection === 'overview' && selectedSeason ? (
        seasonRosterQuery.error || selectedMatchesQuery.error ? <>
          <ErrorState message={(seasonRosterQuery.error ?? selectedMatchesQuery.error)!.message} />
          <button type="button" onClick={() => { void seasonRosterQuery.refetch(); void selectedMatchesQuery.refetch() }} className="mt-3 min-h-11 rounded-lg border border-green-200 px-4 text-sm font-semibold text-green-800">{t('workspace.retry')}</button>
        </> : <SetupSeasonOverview
          season={selectedSeason}
          rosterCount={seasonRosterIds.size}
          teams={teams ?? []}
          fixtureCount={selectedMatches?.length ?? 0}
          completedCount={selectedMatches?.filter(match => match.status === 'completed' || match.status === 'forfeit').length ?? 0}
          preview={selectedPreview.data}
          isLoading={seasonRosterQuery.isPending || selectedMatchesQuery.isPending || !teams || (isDuel && selectedPreview.isPending)}
          onSectionChange={navigateSection}
          leaguePath={leaguePath}
          canCreateSeason={!seasonsLoading && !activeSeason}
          onCreateSeason={() => setShowNewSeason(true)}
        />
      ) : null}

      {activeSection === 'accounts' ? <PlayerAccountLinks key={league.id} /> : null}
      {activeSection === 'prizes' ? <PicklePrizeSettings scope="season" /> : null}

      {activeSection === 'settings' ? (
        <div>
          <LeagueBrandingForm />
          <PicklePrizeSettings scope="league" />
          <Link to={leaguePath('/admin/leagues/new')} className="inline-flex min-h-11 items-center rounded-lg border border-green-200 bg-white px-4 py-2 text-sm font-semibold text-green-800 hover:bg-green-50">
            {t('league.create')}
          </Link>
        </div>
      ) : null}

      {activeSection === 'members' ? (
      <>
      <section className="mb-8 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-green-900">{t('workspace.membersCount', { count: pool.length })}</h2>
        <button type="button" aria-expanded={showAddPlayer} aria-controls="add-league-player" onClick={() => setShowAddPlayer(value => !value)} className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">{t(showAddPlayer ? 'common.close' : 'workspace.addPlayer')}</button>
        </div>
        <p className="mt-1 text-sm text-gray-600">{t('pool.description')}</p>

        {showAddPlayer ? <div id="add-league-player" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-sm font-bold text-blue-950">{t('pool.addToLeagueTitle')}</h3>
          <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t('pool.addToLeagueTitle')}>
            <button type="button" aria-pressed={addPlayerMode === 'existing'} onClick={() => setAddPlayerMode('existing')} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${addPlayerMode === 'existing' ? 'bg-blue-700 text-white' : 'bg-white text-blue-800'}`}>
              {t('pool.useExisting')}
            </button>
            <button type="button" aria-pressed={addPlayerMode === 'new'} onClick={() => setAddPlayerMode('new')} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${addPlayerMode === 'new' ? 'bg-blue-700 text-white' : 'bg-white text-blue-800'}`}>
              {t('pool.createAndAdd')}
            </button>
          </div>
          {addPlayerMode === 'existing' ? (
          <div className="mt-4">
          <h3 className="text-sm font-bold text-blue-950">{t('pool.addExistingTitle')}</h3>
          <p className="mt-1 text-sm text-blue-800">{t('pool.addExistingDescription')}</p>
          {sharedPlayersLoading ? (
            <p className="mt-3 text-sm text-blue-800">{t('common.loading')}</p>
          ) : sharedPlayersError ? (
            <p className="mt-3 text-sm text-red-800">{t('pool.sharedPlayersLoadFailed')}</p>
          ) : availableSharedPlayers.length === 0 ? (
            <p className="mt-3 text-sm text-blue-800">{t('pool.noExistingAvailable')}</p>
          ) : (
            <form
              onSubmit={handleAddExistingPoolPlayer}
              className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-blue-900">
                  {t('pool.existingPlayer')}
                </span>
                <Select
                  value={existingPoolPlayerId}
                  onValueChange={(value) => setExistingPoolPlayerId(value)}
                  className={selectClass}
                  required
                >
                  <option value="">{t('pool.existingPlayerPlaceholder')}</option>
                  {availableSharedPlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                      {player.leagueNames.length > 0
                        ? ` — ${player.leagueNames.join(', ')}`
                        : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex w-full flex-col gap-1 sm:w-36">
                <span className="text-xs font-medium text-blue-900">{t('pool.ratingLabel')}</span>
                <input
                  type="number"
                  min={800}
                  max={2500}
                  step={1}
                  value={existingPoolRating}
                  onChange={(event) => setExistingPoolRating(event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-base sm:text-sm"
                  required
                />
              </label>
              <button
                type="submit"
                disabled={addExistingPoolMutation.isPending || !existingPoolPlayerId}
                className="min-h-11 rounded-lg bg-blue-700 px-4 py-3 text-sm font-medium text-white hover:bg-blue-800 active:bg-blue-900 disabled:opacity-50 sm:py-2"
              >
                {addExistingPoolMutation.isPending
                  ? t('pool.addingExisting')
                  : t('pool.addExistingButton')}
              </button>
            </form>
          )}
          </div>
          ) : (
          <div className="mt-4">
        <h3 className="text-sm font-bold text-green-950">{t('pool.addNewTitle')}</h3>
        <form onSubmit={handleAddPoolPlayer} className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <input
            value={newPoolName}
            aria-label={t('pool.addPlaceholder')}
            onChange={(e) => setNewPoolName(e.target.value)}
            placeholder={t('pool.addPlaceholder')}
            className="min-h-11 flex-1 rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm"
            required
          />
          <label className="flex w-full flex-col gap-1 sm:w-36">
            <span className="text-xs font-medium text-gray-600">{t('pool.ratingLabel')}</span>
            <input
              type="number"
              min={800}
              max={2500}
              step={1}
              value={newPoolRating}
              onChange={(e) => setNewPoolRating(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm"
              required
            />
          </label>
          <button
            type="submit"
            disabled={addPoolMutation.isPending}
            className="min-h-11 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2"
          >
            {addPoolMutation.isPending ? t('pool.adding') : t('pool.addButton')}
          </button>
        </form>
          </div>
          )}
        </div> : null}

        {pool.length > 0 ? (
          <div className="mt-5 rounded-xl border border-green-100 bg-green-50/40 p-2.5">
            <div
              className="grid grid-cols-3 gap-1.5"
              role="group"
              aria-label={t('pool.statusFilterLabel')}
            >
              {(['active', 'inactive', 'all'] as const).map((status) => {
                const count = status === 'active'
                  ? activeCount
                  : status === 'inactive'
                    ? inactiveCount
                    : pool.length
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={poolStatusFilter === status}
                    onClick={() => setPoolStatusFilter(status)}
                    className={`min-h-11 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
                      poolStatusFilter === status
                        ? 'bg-green-600 text-white shadow-sm'
                        : 'bg-white text-green-800 hover:bg-green-100'
                    }`}
                  >
                    {t(`pool.statusFilter.${status}`, { count })}
                  </button>
                )
              })}
            </div>
            <label className="mt-2.5 block">
              <span className="sr-only">{t('pool.searchLabel')}</span>
              <input
                type="search"
                value={poolSearch}
                onChange={(event) => setPoolSearch(event.target.value)}
                placeholder={t('pool.searchPlaceholder')}
                className="min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base sm:text-sm"
              />
            </label>
          </div>
        ) : null}

        {pool.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">{t('pool.empty')}</p>
        ) : visiblePool.length === 0 ? (
          <p className="mt-4 rounded-lg bg-gray-50 px-3 py-4 text-sm text-gray-600">
            {t('pool.noFilterResults')}
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {visiblePool.map((player) => (
              <PoolPlayerRow
                key={player.id}
                player={player}
                isAssigned={assignedIds.has(player.id)}
                isOnActiveSeasonTeam={activeSeasonAssigned.has(player.id)}
                isSaving={
                  updatePoolMutation.isPending &&
                  updatePoolMutation.variables?.id === player.id
                }
                isStatusSaving={
                  updatePoolStatusMutation.isPending &&
                  updatePoolStatusMutation.variables?.id === player.id
                }
                onSave={(id, name) => updatePoolMutation.mutate({ id, name })}
                onDelete={handleDeletePoolPlayer}
                onToggleStatus={(id, status) =>
                  updatePoolStatusMutation.mutate({ id, status })
                }
              />
            ))}
          </ul>
        )}
      </section>
      </>
      ) : null}

      {activeSection === 'roster' && selectedSeason && isSelectedSeasonActive && selectedMatches?.length === 0 ? <SeasonFormatSelector season={selectedSeason} locked={false} /> : null}

      {activeSection === 'roster' && selectedSeason ? (
        <section className="mb-6 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-green-900">
            {t('setup.seasonRosterTitle', { name: selectedSeason.name })}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{t(!isSelectedSeasonActive ? 'setup.seasonRosterArchived' : selectedMatchesQuery.isPending ? 'common.loading' : duelRosterLocked ? 'leagueDuel.frozen' : isDuel ? 'leagueDuel.rosterHelp' : 'setup.seasonRosterHelp', { name: selectedSeason.name })}</p>
          {seasonRosterQuery.isLoading ? <p className="mt-4 text-sm text-gray-600">{t('common.loading')}</p> : null}
          {seasonRosterQuery.error ? <div className="mt-4"><ErrorState message={(seasonRosterQuery.error as Error).message} /></div> : null}
          {seasonRosterQuery.isSuccess ? (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-green-900">
                  {t('setup.seasonRosterCount', { count: seasonRosterDraft.length })}
                </p>
                {!rosterReadOnly ? <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!isSelectedSeasonActive || duelRosterLocked} onClick={() => setSeasonRosterDraft(pool.filter((player) => player.status === 'active').map((player) => player.id))} className="min-h-11 rounded-lg border border-green-200 px-3 py-2 text-sm font-semibold text-green-800 hover:bg-green-50 disabled:opacity-50">
                    {t('setup.seasonRosterSelectAll')}
                  </button>
                  <button type="button" disabled={!isSelectedSeasonActive || duelRosterLocked} onClick={() => setSeasonRosterDraft([...assignedIds])} className="min-h-11 rounded-lg border border-green-200 px-3 py-2 text-sm font-semibold text-green-800 hover:bg-green-50 disabled:opacity-50">
                    {t('setup.seasonRosterClearUnassigned')}
                  </button>
                </div> : null}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(rosterReadOnly ? pool.filter(player => seasonRosterIds.has(player.id)) : pool).map((player) => {
                  const isAssigned = assignedIds.has(player.id)
                  const isInactive = player.status !== 'active'
                  return (
                    <label key={player.id} className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-sm ${isInactive ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-green-100 bg-green-50/40 text-gray-900'}`}>
                      <input
                        type="checkbox"
                        checked={draftRosterIds.has(player.id)}
                        disabled={!isSelectedSeasonActive || duelRosterLocked || (!isDuel && isAssigned) || (isInactive && !draftRosterIds.has(player.id)) || seasonRosterMutation.isPending}
                        onChange={(event) => setSeasonRosterDraft((current) =>
                          event.target.checked
                            ? [...current, player.id]
                            : current.filter((id) => id !== player.id),
                        )}
                        className="size-5 shrink-0 accent-green-700"
                      />
                      <span className="min-w-0 flex-1 break-words font-semibold">{player.name}</span>
                      {isAssigned ? <span className="text-xs text-green-800">{t('setup.seasonRosterOnTeam')}</span> : null}
                      {isInactive ? <span className="text-xs">{t('pool.statusInactive')}</span> : null}
                    </label>
                  )
                })}
              </div>
              {pool.length === 0 ? <p className="mt-4 text-sm text-gray-600">{t('setup.seasonRosterEmpty')}</p> : null}
              {!rosterReadOnly ? <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!isSelectedSeasonActive || duelRosterLocked || !seasonRosterDirty || seasonRosterMutation.isPending}
                  onClick={() => seasonRosterMutation.mutate(seasonRosterDraft)}
                  className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {seasonRosterMutation.isPending ? t('common.loading') : t('setup.seasonRosterSave')}
                </button>
                <p className="text-sm text-gray-600">{t('setup.seasonRosterNext')}</p>
              </div> : <button type="button" onClick={() => navigateSection('teams')} className="mt-4 min-h-11 font-semibold text-green-800 underline">{t('workspace.sections.teams')} ›</button>}
              {seasonRosterMutation.error ? <div className="mt-3"><ErrorState message={(seasonRosterMutation.error as Error).message} /></div> : null}
            </>
          ) : null}
        </section>
      ) : null}

      {activeSection === 'roster' && activeSeason && !isSelectedSeasonActive ? (
        <section className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p>{t('setup.seasonRosterArchived', { name: selectedSeason?.name })}</p>
          <button type="button" onClick={() => setSelectedSeasonId(activeSeason.id)} className="mt-3 font-semibold underline underline-offset-2">
            {t('setup.seasonRosterOpenActive', { name: activeSeason.name })}
          </button>
        </section>
      ) : null}

      {activeSection === 'finish' && selectedSeason?.status === 'archived' ? <section className="mb-6 rounded-xl border border-green-200 bg-white p-5">
        <h2 className="font-bold text-green-950">{t('workspace.seasonFinal')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('workspace.archivedOverviewHelp')}</p>
        <Link to={leaguePath('/bets?tab=history')} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-green-800 underline">{t('workspace.viewBetHistory')}</Link>
        {isDuel ? selectedPreview.isLoading ? <p>{t('common.loading')}</p> : selectedPreview.error ? <ErrorState message={selectedPreview.error.message} /> : selectedPreview.data ? <PickleDistribution preview={selectedPreview.data} /> : null : null}
      </section> : null}

      {activeSection === 'finish' && activeSeason && isSelectedSeasonActive ? <section className="mb-6 rounded-xl border border-green-200 bg-white p-5">
        <h2 className="font-bold text-green-950">{t('workspace.finishChecklist')}</h2>
        <ul className="mt-2 divide-y divide-green-100">
          <li className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h3 className="font-semibold text-green-950">{t('workspace.matchResults')}</h3><p className="mt-1 text-sm text-gray-600">{selectedMatchesQuery.isLoading ? t('common.loading') : selectedMatchesQuery.error ? t('workspace.resultsUnavailable') : t('workspace.resultsProgress', { completed: recordedCount, total: activeSeasonMatches?.length ?? 0 })}</p></div><Link to={leaguePath('/matches')} className="min-h-11 content-center rounded-lg px-2 text-sm font-semibold text-green-800 hover:bg-green-50">{t('nav.matches')} ›</Link></li>
          <li className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h3 className="font-semibold text-green-950">{t('workspace.betSettlements')}</h3><p className="mt-1 text-sm text-gray-600">{seasonBets.isLoading ? t('common.loading') : seasonBets.error ? t('workspace.betsUnavailable') : unsettledBetCount === 0 ? t('workspace.betsReady') : t('workspace.betsPending', { count: unsettledBetCount })}</p></div><Link to={leaguePath('/bets?tab=history')} className="min-h-11 content-center rounded-lg px-2 text-sm font-semibold text-green-800 hover:bg-green-50">{t('workspace.reviewBets')} ›</Link></li>
          {isDuel ? <li className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h3 className="font-semibold text-green-950">{t('workspace.prizeDistribution')}</h3><p className="mt-1 text-sm text-gray-600">{t(archivePreview.data?.configured && archivePreview.data.complete && archivePreview.data.valid ? 'workspace.prizesReady' : 'workspace.prizesReview')}</p></div><button type="button" onClick={() => navigateSection('prizes')} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-green-800 hover:bg-green-50">{t('workspace.sections.prizes')} ›</button></li> : null}
        </ul>
        {seasonBets.error ? <><ErrorState message={betErrorMessage(seasonBets.error, t)} /><button type="button" onClick={() => void seasonBets.refetch()} className="mt-2 min-h-11 font-semibold text-green-800 underline">{t('workspace.retry')}</button></> : null}
        {selectedMatchesQuery.error ? <ErrorState message={selectedMatchesQuery.error.message} /> : null}
      </section> : null}

      {activeSection === 'finish' && activeSeason && isSelectedSeasonActive && (
        <section className="mb-8 rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-amber-900">{t('setup.archiveTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('setup.archiveDescription')}</p>
          <p className="mt-2 text-sm text-gray-600">{t(isDuel ? 'pickle.archiveWarning' : 'workspace.archiveResultsWarning')}</p>
          <p className="mt-2 text-sm font-medium text-gray-700">
            {t('setup.activeSeason', { name: activeSeason.name })}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {t('setup.recordedCount', { count: recordedCount })}
          </p>
          <button
            type="button"
            onClick={handleArchiveSeason}
            disabled={preparingArchive || archiveMutation.isPending || seasonBets.isPending || seasonBets.isError || unsettledBetCount !== 0 || (isDuel && (!archivePreview.data?.configured || !archivePreview.data.complete || activeSeasonMatches?.some((m) => m.status === 'scheduled')))}
            className="mt-4 min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100 active:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2"
          >
            {preparingArchive || archiveMutation.isPending ? t('setup.archiving') : t('workspace.reviewArchive')}
          </button>
          {isDuel ? <>
            <button type="button" onClick={() => navigateSection('prizes')} className="ml-3 inline-flex min-h-11 items-center text-sm font-semibold text-green-800 underline">{t('workspace.sections.prizes')}</button>
            {archivePreview.isLoading ? <p>{t('common.loading')}</p> : archivePreview.error ? <ErrorState message={archivePreview.error.message} /> : archivePreview.data ? <PickleDistribution preview={archivePreview.data} /> : null}
          </> : null}
        </section>
      )}

      {activeSection === 'overview' && !seasonsLoading && !activeSeason && (showNewSeason || !selectedSeason) && (
        <section className="mb-8 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-green-900">{t('setup.newSeasonTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('setup.newSeasonDescription')}</p>
          <form onSubmit={handleStartNewSeason} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Select aria-label={t('leagueDuel.chooseFormat')} value={newSeasonFormat} onValueChange={(value) => setNewSeasonFormat(value as SeasonFormat)} className={selectClass}>
              <option value="round_robin">{t('leagueDuel.roundRobin')}</option><option value="team_duel">{t('leagueDuel.title')}</option>
            </Select>
            <input
              value={newSeasonName}
              aria-label={t('setup.newSeasonPlaceholder')}
              onChange={(e) => setNewSeasonName(e.target.value)}
              placeholder={t('setup.newSeasonPlaceholder')}
              className="min-h-11 flex-1 rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm"
              required
            />
            <button
              type="submit"
              disabled={createSeasonMutation.isPending}
              className="min-h-11 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2"
            >
              {createSeasonMutation.isPending
                ? t('setup.creatingSeason')
                : t('setup.newSeasonButton')}
            </button>
          </form>
        </section>
      )}

      {activeSection === 'teams' && isDuel && selectedSeason ? <LeagueTeamDuelSetup key={selectedSeason.id} season={selectedSeason} rosterIds={seasonRosterQuery.data ?? []} teams={teams ?? []} fixtures={selectedMatches} hasFixtures={!selectedMatches || selectedMatches.length > 0 || !isSelectedSeasonActive} editable={isSelectedSeasonActive} /> : null}

      {activeSection === 'teams' && !isDuel ? (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-green-900">{t('setup.currentTeams')}</h2>
          {(teams ?? []).length === 0 ? <p className="rounded-xl border border-green-200 bg-white p-4 text-sm text-gray-600">{t('setup.noTeams')}</p> : null}
          <div className="space-y-3">
            {(teams ?? []).map((team) => isSelectedSeasonActive ? (
              <details key={team.id} className="rounded-xl border border-green-200 bg-white shadow-sm">
                <summary className="flex min-h-14 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 font-semibold text-green-950">
                  <span className="min-w-0 break-words">{team.name}</span>
                  <span className="min-w-0 break-words text-xs font-normal text-gray-600">{team.players.map((player) => player.name).join(' · ')}</span>
                </summary>
                <div className="border-t border-green-100 p-2">
                  <TeamEditForm
                    team={team}
                    seasonId={selectedSeason!.id}
                    pool={pool}
                    assignedIds={assignedIds}
                    seasonRosterIds={seasonRosterIds}
                    onSaved={(message) => setFeedback({ text: message, tone: 'ok' })}
                    onDeleted={(message) => setFeedback({ text: message, tone: 'ok' })}
                    onError={(message) => setFeedback({ text: message, tone: 'error' })}
                  />
                </div>
              </details>
            ) : (
              <div key={team.id} className="rounded-xl border border-green-200 bg-white p-4 shadow-sm">
                <h3 className="font-semibold text-green-950">{team.name}</h3>
                <p className="mt-1 text-sm text-gray-600">{team.players.map((player) => player.name).join(' · ')}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeSection === 'teams' && !isDuel && isSelectedSeasonActive && (
        <section className="mb-8 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-green-900">{t('setup.createTeamTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('setup.createTeamDescription')}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-semibold text-blue-900">{t('setup.seasonRosterTeamSummary', { count: seasonRosterIds.size, available: activeUnassigned.length })}</p>
            <button type="button" onClick={() => navigateSection('roster')} className="text-sm font-bold text-blue-800 underline underline-offset-2">
              {t('setup.seasonRosterManage')}
            </button>
          </div>
          {seasonRosterQuery.error ? <div className="mt-3"><ErrorState message={(seasonRosterQuery.error as Error).message} /></div> : null}
          {activeUnassigned.length < 2 && (
            <p className="mt-2 text-sm text-amber-700">{t('setup.notEnoughPlayers')}</p>
          )}

          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-blue-900">
              {t('setup.balancedTeamsTitle')}
            </h3>
            <p className="mt-1 text-sm text-blue-800">{t('setup.balancedTeamsDescription')}</p>
            <BalancedTeamsBuilder
              key={activeUnassigned.map((player) => player.id).sort().join(':')}
              players={activeUnassigned}
              partnershipCounts={partnershipCounts}
              isHistoryLoading={isPartnershipHistoryLoading}
              isPending={balanceTeamsMutation.isPending || deleteTeamsMutation.isPending}
              onCreate={handleCreateBalancedTeams}
            />
          </div>

          <form onSubmit={handleCreateTeam} className="mt-6 space-y-3 border-t border-green-100 pt-6">
            <p className="text-sm font-medium text-green-900">{t('setup.createTeamManual')}</p>
            <input
              value={newTeam.name}
              aria-label={t('setup.teamNameLabel')}
              onChange={(e) => setNewTeam((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('setup.teamNamePlaceholder')}
              className="min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm"
              required
            />
            <Select
              value={newTeam.poolPlayerId1}
              onValueChange={(value) =>
                setNewTeam((prev) => ({ ...prev, poolPlayerId1: value }))
              }
              className={selectClass}
              aria-label={t('setup.pickPlayer1')}
              required
            >
              <option value="">{t('setup.pickPlayer1')}</option>
              {createSlot1Options.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </Select>
            <Select
              value={newTeam.poolPlayerId2}
              onValueChange={(value) =>
                setNewTeam((prev) => ({ ...prev, poolPlayerId2: value }))
              }
              className={selectClass}
              aria-label={t('setup.pickPlayer2')}
              required
            >
              <option value="">{t('setup.pickPlayer2')}</option>
              {createSlot2Options.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </Select>
            <button
              type="submit"
              disabled={
                createTeamMutation.isPending ||
                activeUnassigned.length < 2 ||
                !newTeam.poolPlayerId1 ||
                !newTeam.poolPlayerId2 ||
                newTeam.poolPlayerId1 === newTeam.poolPlayerId2
              }
              className="min-h-11 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2"
            >
              {createTeamMutation.isPending
                ? t('setup.creatingTeam')
                : t('setup.createTeamButton')}
            </button>
          </form>
        </section>
      )}

      {activeSection === 'teams' && !isDuel && isSelectedSeasonActive && (teams ?? []).length > 0 ? (
        <details className="mb-8 rounded-xl border border-red-200 bg-red-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-red-900">{t('setup.dangerZone')}</summary>
          <p className="mt-3 text-sm text-red-800">{t('setup.deleteTeamsHint')}</p>
          <button
            type="button"
            onClick={handleDeleteAllTeams}
            disabled={deleteTeamsMutation.isPending || balanceTeamsMutation.isPending || createTeamMutation.isPending || recordedCount > 0}
            className="mt-3 min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {deleteTeamsMutation.isPending ? t('setup.deleteTeamsWorking') : t('setup.deleteTeamsButton')}
          </button>
        </details>
      ) : null}

      </>}
      </SetupWorkspace>
    </div>
  )
}
