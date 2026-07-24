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
  deletePoolPlayer,
  fetchMatches,
  resetSeasonTeams,
  saveTeamWithPlayers,
  updatePoolPlayer,
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
    return !assignedIds.has(player.id)
  })
}

function PoolPlayerRow({
  player,
  isAssigned,
  isSaving,
  onSave,
  onDelete,
}: {
  player: PoolPlayer
  isAssigned: boolean
  isSaving: boolean
  onSave: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(player.name)

  useEffect(() => {
    setName(player.name)
  }, [player.name])

  const trimmed = name.trim()
  const isDirty = trimmed !== player.name

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-3 sm:flex-row sm:items-center">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-h-11 flex-1 rounded-lg border border-green-200 bg-white px-3 py-2 text-base sm:text-sm"
      />
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
        disabled={isSaving}
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
  const { data: activeSeasonMatches } = useQuery({
    queryKey: ['matches', activeSeason?.id],
    queryFn: () => fetchMatches(activeSeason!.id),
    enabled: !!activeSeason,
  })
  const [saved, setSaved] = useState<string | null>(null)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [newPoolName, setNewPoolName] = useState('')
  const [newTeam, setNewTeam] = useState({
    name: '',
    poolPlayerId1: '',
    poolPlayerId2: '',
  })

  const assignedIds = useMemo(() => new Set(assignedPoolIds), [assignedPoolIds])
  const availablePool = useMemo(
    () => pool.filter((player) => !assignedIds.has(player.id)),
    [pool, assignedIds],
  )

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
    mutationFn: (name: string) => createPoolPlayer(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setNewPoolName('')
      setSaved(t('pool.added'))
    },
    onError: (err: Error) => setSaved(t('pool.saveFailed', { message: err.message })),
  })

  const updatePoolMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updatePoolPlayer(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setSaved(t('pool.updated'))
    },
    onError: (err: Error) => setSaved(t('pool.saveFailed', { message: err.message })),
  })

  const deletePoolMutation = useMutation({
    mutationFn: (id: string) => deletePoolPlayer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['player-pool'] })
      setSaved(t('pool.deleted'))
    },
    onError: (err: Error) => setSaved(t('pool.deleteFailed', { message: err.message })),
  })

  const archiveMutation = useMutation({
    mutationFn: (seasonId: string) => archiveSeason(seasonId),
    onSuccess: (season) => {
      invalidateSeasonData()
      setSelectedSeasonId(season.id)
      setSaved(t('setup.archiveSuccess', { name: season.name }))
    },
    onError: (err: Error) =>
      setSaved(t('setup.archiveFailed', { message: err.message })),
  })

  const createSeasonMutation = useMutation({
    mutationFn: (name: string) => createSeason(name),
    onSuccess: (season) => {
      invalidateSeasonData()
      setSelectedSeasonId(season.id)
      setNewSeasonName('')
      setSaved(t('setup.newSeasonSuccess', { name: season.name }))
    },
    onError: (err: Error) =>
      setSaved(t('setup.newSeasonFailed', { message: err.message })),
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
      setSaved(t('setup.teamCreated'))
    },
    onError: (err: Error) =>
      setSaved(t('setup.createTeamFailed', { message: err.message })),
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
      setSaved(t('setup.balancedTeamsCreated', { count }))
    },
    onError: (err: Error) =>
      setSaved(t('setup.balancedTeamsFailed', { message: err.message })),
  })

  const resetTeamsMutation = useMutation({
    mutationFn: (payload: {
      name: string
      color: string
      poolPlayerIds: [string, string]
    }[]) => resetSeasonTeams(selectedSeason!.id, payload),
    onSuccess: (count) => {
      invalidateSeasonData()
      setSaved(t('setup.resetTeamsSuccess', { count }))
    },
    onError: (err: Error) =>
      setSaved(t('setup.resetTeamsFailed', { message: err.message })),
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
    addPoolMutation.mutate(name)
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
    if (availablePool.length < 2 || availablePool.length % 2 !== 0) {
      setSaved(t('setup.balancedTeamsNeedEven'))
      return
    }

    const balanced = generateBalancedTeams(
      availablePool.map((player) => ({
        id: player.id,
        name: player.name,
        rating: player.rating,
      })),
    )

    const preview = balanced
      .map(
        (team, index) =>
          `${index + 1}. ${team.playerNames[0]} + ${team.playerNames[1]} (${roundRating(team.teamRating / 2)} avg)`,
      )
      .join('\n')

    if (!confirm(`${t('setup.balancedTeamsConfirm', { count: balanced.length })}\n\n${preview}`)) {
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

  function handleResetAndRebalanceTeams() {
    if (!selectedSeason) return
    const roster = (teams ?? []).flatMap((team) => team.players)
    const uniqueIds = [...new Set(roster.map((player) => player.pool_player_id))]
    const ratedPlayers = uniqueIds
      .map((id) => pool.find((player) => player.id === id))
      .filter((player): player is NonNullable<typeof player> => player != null)
      .map((player) => ({
        id: player.id,
        name: player.name,
        rating: player.rating,
      }))

    if (ratedPlayers.length < 2 || ratedPlayers.length % 2 !== 0) {
      setSaved(t('setup.resetTeamsNeedEven'))
      return
    }

    const balanced = generateBalancedTeams(ratedPlayers)
    const preview = balanced
      .map(
        (team, index) =>
          `${index + 1}. ${team.playerNames[0]} + ${team.playerNames[1]} (${roundRating(team.teamRating / 2)} avg)`,
      )
      .join('\n')

    const matchCount = (activeSeasonMatches ?? []).length
    const confirmMessage =
      matchCount > 0
        ? t('setup.resetTeamsConfirmWithMatches', {
            count: balanced.length,
            matches: matchCount,
          })
        : t('setup.resetTeamsConfirm', { count: balanced.length })

    if (!confirm(`${confirmMessage}\n\n${preview}`)) return

    const usedColors: string[] = []
    const payloads = balanced.map((team) => {
      const color = pickNextTeamColor(usedColors)
      usedColors.push(color)
      return {
        name: `${team.playerNames[0]} / ${team.playerNames[1]}`,
        color,
        poolPlayerIds: team.poolPlayerIds,
      }
    })

    resetTeamsMutation.mutate(payloads)
  }

  function handleDeletePoolPlayer(id: string, name: string) {
    if (!confirm(t('pool.deleteConfirm', { name }))) return
    deletePoolMutation.mutate(id)
  }

  const createSlot1Options = availablePool.filter(
    (player) => player.id !== newTeam.poolPlayerId2,
  )
  const createSlot2Options = availablePool.filter(
    (player) => player.id !== newTeam.poolPlayerId1,
  )

  if (isError) return <ErrorState message={(error as Error).message} />
  if (poolError) return <ErrorState message={(poolQueryError as Error).message} />

  return (
    <div>
      <SetupBanner />
      <ArchivedSeasonBanner />
      <PageHeader title={t('setup.title')} subtitle={t('setup.subtitle')} />

      {saved && (
        <p className="mb-4 rounded-lg bg-green-100 px-3 py-2 text-sm text-green-800">
          {saved}
        </p>
      )}

      <section className="mb-8 rounded-xl border border-green-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-green-900">{t('pool.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('pool.description')}</p>

        <form onSubmit={handleAddPoolPlayer} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={newPoolName}
            onChange={(e) => setNewPoolName(e.target.value)}
            placeholder={t('pool.addPlaceholder')}
            className="min-h-11 flex-1 rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm"
            required
          />
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
                isSaving={
                  updatePoolMutation.isPending &&
                  updatePoolMutation.variables?.id === player.id
                }
                onSave={(id, name) => updatePoolMutation.mutate({ id, name })}
                onDelete={handleDeletePoolPlayer}
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
          {availablePool.length < 2 && (
            <p className="mt-2 text-sm text-amber-700">{t('setup.notEnoughPlayers')}</p>
          )}

          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h3 className="text-sm font-semibold text-blue-900">
              {t('setup.balancedTeamsTitle')}
            </h3>
            <p className="mt-1 text-sm text-blue-800">{t('setup.balancedTeamsDescription')}</p>
            {availablePool.length % 2 !== 0 && availablePool.length > 0 && (
              <p className="mt-2 text-sm text-amber-700">{t('setup.balancedTeamsNeedEven')}</p>
            )}
            <button
              type="button"
              onClick={handleGenerateBalancedTeams}
              disabled={
                balanceTeamsMutation.isPending ||
                resetTeamsMutation.isPending ||
                availablePool.length < 2 ||
                availablePool.length % 2 !== 0
              }
              className="mt-3 min-h-11 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 sm:w-auto sm:py-2"
            >
              {balanceTeamsMutation.isPending
                ? t('setup.balancedTeamsGenerating')
                : t('setup.balancedTeamsButton', { count: Math.floor(availablePool.length / 2) })}
            </button>
            {(teams ?? []).length > 0 && (
              <button
                type="button"
                onClick={handleResetAndRebalanceTeams}
                disabled={
                  resetTeamsMutation.isPending ||
                  balanceTeamsMutation.isPending ||
                  createTeamMutation.isPending
                }
                className="mt-2 min-h-11 w-full rounded-lg border border-blue-300 bg-white px-4 py-3 text-sm font-medium text-blue-800 hover:bg-blue-50 active:bg-blue-100 disabled:opacity-50 sm:w-auto sm:py-2"
              >
                {resetTeamsMutation.isPending
                  ? t('setup.resetTeamsWorking')
                  : t('setup.resetTeamsButton')}
              </button>
            )}
            {(teams ?? []).length > 0 && (
              <p className="mt-2 text-xs text-blue-700">{t('setup.resetTeamsHint')}</p>
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
                availablePool.length < 2 ||
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
              onSaved={setSaved}
              onError={setSaved}
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
