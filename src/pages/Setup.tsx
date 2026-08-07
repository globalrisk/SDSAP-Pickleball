import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
  fetchAssignedPoolPlayerIds,
  fetchMatches,
  saveTeamWithPlayers,
  updatePoolPlayer,
  updatePoolPlayerStatus,
} from '../lib/api'
import { generateBalancedTeams } from '../lib/balanceTeams'
import { roundRating } from '../lib/ratings'
import { ArchivedSeasonBanner } from '../components/ArchivedSeasonBanner'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { useSeason } from '../context/SeasonContext'
import { useAssignedPoolPlayerIds, usePlayerPool } from '../hooks/usePlayerPool'
import { useTeamsWithPlayers } from '../hooks/useTeams'
import type { PoolPlayer, TeamWithPlayers } from '../types'

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

function pickNextTeamColor(usedColors: string[]): string {
  const used = new Set(usedColors)
  const next = TEAM_COLORS.find((color) => !used.has(color))
  if (next) return next
  return TEAM_COLORS[usedColors.length % TEAM_COLORS.length]
}

const selectClass =
  'min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base sm:text-sm'

function poolOptionsForSlot(
  pool: PoolPlayer[],
  assignedIds: Set<string>,
  teamPoolIds: Set<string>,
  slotValue: string,
  otherSlotValue: string,
) {
  return pool.filter((player) => {
    if (player.id === slotValue || player.id === otherSlotValue) return true
    if (teamPoolIds.has(player.id)) return true
    if (player.status !== 'active') return false
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
  const [name, setName] = useState(player.name)

  useEffect(() => {
    setName(player.name)
  }, [player.name])

  const trimmed = name.trim()
  const isDirty = trimmed !== player.name
  const isActive = player.status === 'active'
  const cannotDeactivate = isActive && isOnActiveSeasonTeam

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-h-11 flex-1 rounded-lg border border-green-200 bg-white px-3 py-2 text-base sm:text-sm"
      />
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
          isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'
        }`}
      >
        {isActive ? t('pool.statusActive') : t('pool.statusInactive')}
      </span>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
          isAssigned ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
        }`}
      >
        {isAssigned ? t('pool.assigned') : t('pool.available')}
      </span>
      <span className="shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">
        <Link to={`/players/${player.id}`} className="hover:underline">
          {t('pool.ratingBadge', { rating: roundRating(player.rating) })}
        </Link>
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          onClick={() =>
            onToggleStatus(player.id, isActive ? 'inactive' : 'active')
          }
          disabled={isStatusSaving || cannotDeactivate}
          title={cannotDeactivate ? t('pool.cannotDeactivateOnTeam') : undefined}
          className="min-h-11 rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
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
    </li>
  )
}

function TeamEditForm({
  team,
  seasonId,
  pool,
  assignedIds,
  onSaved,
  onError,
}: {
  team: TeamWithPlayers
  seasonId: string
  pool: PoolPlayer[]
  assignedIds: Set<string>
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
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

  const slot1Options = poolOptionsForSlot(
    pool,
    assignedIds,
    teamPoolIds,
    poolPlayerIds[0],
    poolPlayerIds[1],
  )
  const slot2Options = poolOptionsForSlot(
    pool,
    assignedIds,
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
        onChange={(e) => setTeamName(e.target.value)}
        className="mb-4 min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base font-medium sm:text-sm"
        required
      />

      <div className="space-y-2">
        <select
          value={poolPlayerIds[0]}
          onChange={(e) =>
            setPoolPlayerIds(([_, second]) => [e.target.value, second])
          }
          className={selectClass}
          required
        >
          <option value="">{t('setup.pickPlayer1')}</option>
          {slot1Options.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>
        <select
          value={poolPlayerIds[1]}
          onChange={(e) =>
            setPoolPlayerIds(([first]) => [first, e.target.value])
          }
          className={selectClass}
          required
        >
          <option value="">{t('setup.pickPlayer2')}</option>
          {slot2Options.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={
          saveMutation.isPending ||
          !poolPlayerIds[0] ||
          !poolPlayerIds[1] ||
          poolPlayerIds[0] === poolPlayerIds[1]
        }
        className="mt-4 min-h-11 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2"
      >
        {t('setup.saveTeam')}
      </button>
    </form>
  )
}

export function SetupPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { selectedSeason, activeSeason, isSelectedSeasonActive, setSelectedSeasonId } =
    useSeason()
  const { data: teams, isError, error } = useTeamsWithPlayers()
  const { data: pool = [], isError: poolError, error: poolQueryError } = usePlayerPool()
  const { data: assignedPoolIds = [] } = useAssignedPoolPlayerIds()
  const { data: activeSeasonAssignedIds = [] } = useQuery({
    queryKey: ['assigned-pool-players', activeSeason?.id],
    queryFn: () => fetchAssignedPoolPlayerIds(activeSeason!.id),
    enabled: !!activeSeason,
  })
  const { data: activeSeasonMatches } = useQuery({
    queryKey: ['matches', activeSeason?.id],
    queryFn: () => fetchMatches(activeSeason!.id),
    enabled: !!activeSeason,
  })
  const [feedback, setFeedback] = useState<{
    text: string
    tone: 'ok' | 'error'
  } | null>(null)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [newPoolName, setNewPoolName] = useState('')
  const [newPoolRating, setNewPoolRating] = useState('1500')
  const [newTeam, setNewTeam] = useState({
    name: '',
    poolPlayerId1: '',
    poolPlayerId2: '',
  })

  const assignedIds = useMemo(() => new Set(assignedPoolIds), [assignedPoolIds])
  const activeSeasonAssigned = useMemo(
    () => new Set(activeSeasonAssignedIds),
    [activeSeasonAssignedIds],
  )
  const activeUnassigned = useMemo(
    () =>
      pool.filter(
        (player) => player.status === 'active' && !assignedIds.has(player.id),
      ),
    [pool, assignedIds],
  )
  const activeCount = useMemo(
    () => pool.filter((player) => player.status === 'active').length,
    [pool],
  )
  const maxTeamCount = Math.floor(activeUnassigned.length / 2)

  const recordedCount = (activeSeasonMatches ?? []).filter(
    (m) => m.status === 'completed' || m.status === 'forfeit',
  ).length

  function invalidateSeasonData() {
    queryClient.invalidateQueries({ queryKey: ['seasons'] })
    queryClient.invalidateQueries({ queryKey: ['teams'] })
    queryClient.invalidateQueries({ queryKey: ['teams-with-players'] })
    queryClient.invalidateQueries({ queryKey: ['matches'] })
    queryClient.invalidateQueries({ queryKey: ['assigned-pool-players'] })
  }

  const addPoolMutation = useMutation({
    mutationFn: ({ name, rating }: { name: string; rating: number }) =>
      createPoolPlayer(name, rating),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setNewPoolName('')
      setNewPoolRating('1500')
      setFeedback({ text: t('pool.added'), tone: 'ok' })
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
    }) => updatePoolPlayerStatus(id, status),
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
    mutationFn: (id: string) => deletePoolPlayer(id),
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
    mutationFn: (seasonId: string) => archiveSeason(seasonId),
    onSuccess: (season) => {
      invalidateSeasonData()
      setSelectedSeasonId(season.id)
      setFeedback({ text: t('setup.archiveSuccess', { name: season.name }), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({ text: t('setup.archiveFailed', { message: err.message }), tone: 'error' }),
  })

  const createSeasonMutation = useMutation({
    mutationFn: (name: string) => createSeason(name),
    onSuccess: (season) => {
      invalidateSeasonData()
      setSelectedSeasonId(season.id)
      setNewSeasonName('')
      setFeedback({ text: t('setup.newSeasonSuccess', { name: season.name }), tone: 'ok' })
    },
    onError: (err: Error) =>
      setFeedback({ text: t('setup.newSeasonFailed', { message: err.message }), tone: 'error' }),
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

  function handleArchiveSeason() {
    if (!activeSeason) return
    if (!confirm(t('setup.archiveConfirm', { name: activeSeason.name, count: recordedCount }))) {
      return
    }
    archiveMutation.mutate(activeSeason.id)
  }

  function handleStartNewSeason(e: React.FormEvent) {
    e.preventDefault()
    const name = newSeasonName.trim()
    if (!name) return
    if (!confirm(t('setup.newSeasonConfirm', { name }))) return
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

  function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSeason) return
    createTeamMutation.mutate({
      name: newTeam.name.trim(),
      color: pickNextTeamColor((teams ?? []).map((team) => team.color)),
      poolPlayerIds: [newTeam.poolPlayerId1, newTeam.poolPlayerId2],
    })
  }

  function handleGenerateBalancedTeams() {
    if (!selectedSeason) return
    if (maxTeamCount < 1) {
      setFeedback({ text: t('setup.notEnoughPlayers'), tone: 'error' })
      return
    }

    const selectedPlayers = [...activeUnassigned]
      .sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating
        return a.name.localeCompare(b.name)
      })
      .slice(0, maxTeamCount * 2)
      .map((player) => ({
        id: player.id,
        name: player.name,
        rating: player.rating,
      }))

    const balanced = generateBalancedTeams(selectedPlayers)

    const preview = balanced
      .map(
        (team, index) =>
          `${index + 1}. ${team.playerNames[0]} + ${team.playerNames[1]} (${roundRating(team.teamRating / 2)} avg)`,
      )
      .join('\n')

    const confirmKey =
      selectedPlayers.length < activeUnassigned.length
        ? 'setup.balancedTeamsConfirmSubset'
        : 'setup.balancedTeamsConfirm'

    if (
      !confirm(
        `${t(confirmKey, {
          count: balanced.length,
          players: selectedPlayers.length,
          available: activeUnassigned.length,
        })}\n\n${preview}`,
      )
    ) {
      return
    }

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

  function handleDeleteAllTeams() {
    if (!selectedSeason) return
    if ((recordedCount ?? 0) > 0) {
      setFeedback({ text: t('setup.deleteTeamsBlocked'), tone: 'error' })
      return
    }
    if (!confirm(t('setup.deleteTeamsConfirm'))) return
    deleteTeamsMutation.mutate()
  }

  function handleDeletePoolPlayer(id: string, name: string) {
    if (!confirm(t('pool.deleteConfirm', { name }))) return
    deletePoolMutation.mutate(id)
  }

  const createSlot1Options = activeUnassigned.filter(
    (player) => player.id !== newTeam.poolPlayerId2,
  )
  const createSlot2Options = activeUnassigned.filter(
    (player) => player.id !== newTeam.poolPlayerId1,
  )

  if (isError) return <ErrorState message={(error as Error).message} />
  if (poolError) return <ErrorState message={(poolQueryError as Error).message} />

  return (
    <div>
      <SetupBanner />
      <ArchivedSeasonBanner />
      <PageHeader title={t('setup.title')} subtitle={t('setup.subtitle')} />

      {feedback && (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            feedback.tone === 'error'
              ? 'border border-red-200 bg-red-50 text-red-800'
              : 'bg-green-100 text-green-800'
          }`}
        >
          {feedback.text}
        </p>
      )}

      <section className="mb-8 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-green-900">{t('pool.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('pool.description')}</p>
        <p className="mt-2 text-sm font-medium text-green-800">
          {t('pool.activeCount', { count: activeCount })}
        </p>

        <form onSubmit={handleAddPoolPlayer} className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <input
            value={newPoolName}
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

        {pool.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">{t('pool.empty')}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {pool.map((player) => (
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

      {activeSeason && (
        <section className="mb-8 rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-amber-900">{t('setup.archiveTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('setup.archiveDescription')}</p>
          <p className="mt-2 text-sm font-medium text-gray-700">
            {t('setup.activeSeason', { name: activeSeason.name })}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {t('setup.recordedCount', { count: recordedCount })}
          </p>
          <button
            type="button"
            onClick={handleArchiveSeason}
            disabled={archiveMutation.isPending}
            className="mt-4 min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100 active:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2"
          >
            {archiveMutation.isPending ? t('setup.archiving') : t('setup.archiveButton')}
          </button>
        </section>
      )}

      {!activeSeason && (
        <section className="mb-8 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-green-900">{t('setup.newSeasonTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('setup.newSeasonDescription')}</p>
          <form onSubmit={handleStartNewSeason} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={newSeasonName}
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

      {isSelectedSeasonActive && (
        <section className="mb-8 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-green-900">{t('setup.createTeamTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('setup.createTeamDescription')}</p>
          {activeUnassigned.length < 2 && (
            <p className="mt-2 text-sm text-amber-700">{t('setup.notEnoughPlayers')}</p>
          )}

          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-blue-900">
              {t('setup.balancedTeamsTitle')}
            </h3>
            <p className="mt-1 text-sm text-blue-800">{t('setup.balancedTeamsDescription')}</p>
            {maxTeamCount > 0 && maxTeamCount * 2 < activeUnassigned.length && (
              <p className="mt-2 text-xs text-blue-800">
                {t('setup.balancedTeamsSubsetHint', {
                  players: maxTeamCount * 2,
                  available: activeUnassigned.length,
                })}
              </p>
            )}
            <button
              type="button"
              onClick={handleGenerateBalancedTeams}
              disabled={
                balanceTeamsMutation.isPending ||
                deleteTeamsMutation.isPending ||
                maxTeamCount < 1
              }
              className="mt-3 min-h-11 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 sm:w-auto sm:py-2"
            >
              {balanceTeamsMutation.isPending
                ? t('setup.balancedTeamsGenerating')
                : t('setup.balancedTeamsButton', {
                    count: maxTeamCount,
                  })}
            </button>
            {(teams ?? []).length > 0 && (
              <button
                type="button"
                onClick={handleDeleteAllTeams}
                disabled={
                  deleteTeamsMutation.isPending ||
                  balanceTeamsMutation.isPending ||
                  createTeamMutation.isPending ||
                  recordedCount > 0
                }
                className="mt-2 min-h-11 w-full rounded-lg border border-red-300 bg-white px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-50 active:bg-red-100 disabled:opacity-50 sm:w-auto sm:py-2"
              >
                {deleteTeamsMutation.isPending
                  ? t('setup.deleteTeamsWorking')
                  : t('setup.deleteTeamsButton')}
              </button>
            )}
            {(teams ?? []).length > 0 && (
              <p className="mt-2 text-xs text-blue-700">{t('setup.deleteTeamsHint')}</p>
            )}
          </div>

          <form onSubmit={handleCreateTeam} className="mt-6 space-y-3 border-t border-green-100 pt-6">
            <p className="text-sm font-medium text-green-900">{t('setup.createTeamManual')}</p>
            <input
              value={newTeam.name}
              onChange={(e) => setNewTeam((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('setup.teamNamePlaceholder')}
              className="min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm"
              required
            />
            <select
              value={newTeam.poolPlayerId1}
              onChange={(e) =>
                setNewTeam((prev) => ({ ...prev, poolPlayerId1: e.target.value }))
              }
              className={selectClass}
              required
            >
              <option value="">{t('setup.pickPlayer1')}</option>
              {createSlot1Options.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
            <select
              value={newTeam.poolPlayerId2}
              onChange={(e) =>
                setNewTeam((prev) => ({ ...prev, poolPlayerId2: e.target.value }))
              }
              className={selectClass}
              required
            >
              <option value="">{t('setup.pickPlayer2')}</option>
              {createSlot2Options.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
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

      <div className="space-y-6">
        {(teams ?? []).length === 0 && (
          <p className="text-sm text-gray-500">{t('setup.noTeams')}</p>
        )}

        {(teams ?? []).map((team) =>
          isSelectedSeasonActive ? (
            <TeamEditForm
              key={team.id}
              team={team}
              seasonId={selectedSeason!.id}
              pool={pool}
              assignedIds={assignedIds}
              onSaved={(message) => setFeedback({ text: message, tone: 'ok' })}
              onError={(message) => setFeedback({ text: message, tone: 'error' })}
            />
          ) : (
            <div
              key={team.id}
              className="rounded-xl border border-green-200 bg-white p-5 shadow-sm"
            >
              <h3 className="mb-4 text-base font-semibold text-gray-900">{team.name}</h3>
              <ul className="space-y-2">
                {team.players.map((player) => (
                  <li
                    key={player.id}
                    className="rounded-lg bg-green-50 px-3 py-2 text-sm text-gray-700"
                  >
                    {player.name}
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
