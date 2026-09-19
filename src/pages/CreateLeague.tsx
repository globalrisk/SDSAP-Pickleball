import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  createLeagueWithSetup,
  fetchSharedPlayerIdentities,
  type LeagueSetupPlayer,
  type LeagueSetupTeam,
} from '../lib/leagueApi'
import { ErrorState, LoadingState, PageHeader } from '../components/Layout'

const TEAM_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

interface TeamDraft extends LeagueSetupTeam {
  key: string
}

export function CreateLeaguePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identitiesQuery = useQuery({
    queryKey: ['shared-player-identities'],
    queryFn: fetchSharedPlayerIdentities,
  })
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [seasonName, setSeasonName] = useState('Season 1')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [newPlayers, setNewPlayers] = useState<LeagueSetupPlayer[]>([])
  const [newPlayerName, setNewPlayerName] = useState('')
  const [teams, setTeams] = useState<TeamDraft[]>([])
  const [validationError, setValidationError] = useState<string | null>(null)

  const selectedPlayers = useMemo<LeagueSetupPlayer[]>(() => {
    const identities = identitiesQuery.data ?? []
    return [
      ...identities
        .filter((player) => selectedIds.includes(player.id))
        .map((player) => ({ ...player, isNew: false, initialRating: 1500 })),
      ...newPlayers,
    ]
  }, [identitiesQuery.data, newPlayers, selectedIds])

  const mutation = useMutation({
    mutationFn: ({ setupLater }: { setupLater: boolean }) => createLeagueWithSetup({
      name,
      seasonName,
      logoFile,
      players: setupLater ? [] : selectedPlayers,
      teams: setupLater ? [] : teams,
    }),
    onSuccess: async ({ league, logoWarning }, { setupLater }) => {
      await queryClient.invalidateQueries({ queryKey: ['leagues'] })
      const destination = setupLater
        ? `/leagues/${league.slug}/setup?section=players${logoWarning ? '&logoWarning=1' : ''}`
        : `/leagues/${league.slug}${logoWarning ? '?logoWarning=1' : ''}`
      navigate(destination, { replace: true })
    },
  })

  function addNewPlayer() {
    const trimmed = newPlayerName.trim()
    if (!trimmed) return
    setNewPlayers((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: trimmed,
        isNew: true,
        initialRating: 1500,
      },
    ])
    setNewPlayerName('')
  }

  function prepareTeams() {
    setValidationError(null)
    if (selectedPlayers.length < 4 || selectedPlayers.length % 2 !== 0) {
      setValidationError(t('leagueCreate.playerCountError'))
      return
    }
    const nextTeams: TeamDraft[] = []
    for (let index = 0; index < selectedPlayers.length; index += 2) {
      nextTeams.push({
        key: crypto.randomUUID(),
        name: t('leagueCreate.defaultTeamName', { number: index / 2 + 1 }),
        color: TEAM_COLORS[(index / 2) % TEAM_COLORS.length]!,
        poolPlayerIds: [selectedPlayers[index]!.id, selectedPlayers[index + 1]!.id],
      })
    }
    setTeams(nextTeams)
    setStep(3)
  }

  function submit() {
    setValidationError(null)
    const used = teams.flatMap((team) => team.poolPlayerIds)
    if (used.length !== selectedPlayers.length || new Set(used).size !== selectedPlayers.length) {
      setValidationError(t('leagueCreate.teamAssignmentError'))
      return
    }
    if (teams.some((team) => !team.name.trim())) {
      setValidationError(t('leagueCreate.teamNameError'))
      return
    }
    mutation.mutate({ setupLater: false })
  }

  if (identitiesQuery.isLoading) return <LoadingState />
  if (identitiesQuery.error) return <ErrorState message={(identitiesQuery.error as Error).message} />

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('leagueCreate.title')} subtitle={t('leagueCreate.subtitle')} />
      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label={t('leagueCreate.progress')}>
        {[1, 2, 3].map((number) => (
          <li key={number} className={`rounded-xl px-3 py-2 text-center text-xs font-bold ${step === number ? 'bg-green-600 text-white' : step > number ? 'bg-green-100 text-green-800' : 'bg-white text-gray-500'}`}>
            {t(`leagueCreate.step${number}`)}
          </li>
        ))}
      </ol>

      <section className="rounded-2xl border border-green-200 bg-white p-5 shadow-sm sm:p-6">
        {step === 1 ? (
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-gray-800">
              {t('leagueCreate.leagueName')}
              <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-green-200 px-3" required />
            </label>
            <label className="block text-sm font-semibold text-gray-800">
              {t('leagueCreate.firstSeason')}
              <input value={seasonName} onChange={(event) => setSeasonName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-green-200 px-3" required />
            </label>
            <label className="block text-sm font-semibold text-gray-800">
              {t('leagueCreate.logo')}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
              <span className="mt-1 block text-xs font-normal text-gray-500">{t('leagueCreate.logoHint')}</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={!name.trim() || !seasonName.trim() || mutation.isPending}
                onClick={() => mutation.mutate({ setupLater: true })}
                className="min-h-11 rounded-xl bg-green-600 px-5 font-bold text-white disabled:opacity-50"
              >
                {mutation.isPending ? t('leagueCreate.creating') : t('leagueCreate.createNow')}
              </button>
              <button
                type="button"
                disabled={!name.trim() || !seasonName.trim() || mutation.isPending}
                onClick={() => setStep(2)}
                className="min-h-11 rounded-xl border border-green-300 px-5 font-bold text-green-800 disabled:opacity-50"
              >
                {t('leagueCreate.addPlayersNow')}
              </button>
            </div>
            <p className="text-sm text-gray-600">{t('leagueCreate.setupLaterHint')}</p>
            {mutation.error ? (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {(mutation.error as Error).message}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="text-lg font-bold text-green-950">{t('leagueCreate.choosePlayers')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('leagueCreate.choosePlayersHint')}</p>
            <div className="mt-4 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {(identitiesQuery.data ?? []).map((player) => (
                <label key={player.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
                  <input type="checkbox" checked={selectedIds.includes(player.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, player.id] : current.filter((id) => id !== player.id))} />
                  <span className="text-sm font-semibold">{player.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 rounded-xl bg-green-50 p-4">
              <p className="text-sm font-bold text-green-950">{t('leagueCreate.addNewPlayer')}</p>
              <div className="mt-2 flex gap-2">
                <input value={newPlayerName} onChange={(event) => setNewPlayerName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addNewPlayer() } }} className="min-h-11 min-w-0 flex-1 rounded-xl border border-green-200 px-3" />
                <button type="button" onClick={addNewPlayer} className="rounded-xl bg-green-700 px-4 text-sm font-bold text-white">{t('common.add')}</button>
              </div>
              {newPlayers.length > 0 ? <ul className="mt-3 flex flex-wrap gap-2">{newPlayers.map((player) => <li key={player.id} className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{player.name} <button type="button" onClick={() => setNewPlayers((current) => current.filter((item) => item.id !== player.id))} aria-label={t('common.remove')}>×</button></li>)}</ul> : null}
            </div>
            <p className="mt-4 text-sm font-semibold text-green-800">{t('leagueCreate.selectedCount', { count: selectedPlayers.length })}</p>
            <div className="mt-5 flex gap-3"><button type="button" onClick={() => setStep(1)} className="min-h-11 flex-1 rounded-xl border border-green-300 font-bold text-green-800">{t('common.back')}</button><button type="button" onClick={prepareTeams} className="min-h-11 flex-1 rounded-xl bg-green-600 font-bold text-white">{t('common.next')}</button></div>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className="text-lg font-bold text-green-950">{t('leagueCreate.formTeams')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('leagueCreate.formTeamsHint')}</p>
            <div className="mt-5 space-y-4">
              {teams.map((team, teamIndex) => (
                <div key={team.key} className="rounded-xl border border-green-100 p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_4rem]">
                    <input value={team.name} onChange={(event) => setTeams((current) => current.map((item, index) => index === teamIndex ? { ...item, name: event.target.value } : item))} className="min-h-11 rounded-xl border border-green-200 px-3 font-semibold" aria-label={t('leagueCreate.teamName')} />
                    <input type="color" value={team.color} onChange={(event) => setTeams((current) => current.map((item, index) => index === teamIndex ? { ...item, color: event.target.value } : item))} className="h-11 w-full rounded-xl border border-green-200 p-1" aria-label={t('leagueCreate.teamColor')} />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[0, 1].map((slot) => <select key={slot} value={team.poolPlayerIds[slot]} onChange={(event) => setTeams((current) => current.map((item, index) => index === teamIndex ? { ...item, poolPlayerIds: slot === 0 ? [event.target.value, item.poolPlayerIds[1]] : [item.poolPlayerIds[0], event.target.value] } : item))} className="min-h-11 rounded-xl border border-green-200 px-3">{selectedPlayers.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>)}
                  </div>
                </div>
              ))}
            </div>
            {validationError ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{validationError}</p> : null}
            {mutation.error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{(mutation.error as Error).message}</p> : null}
            <div className="mt-5 flex gap-3"><button type="button" onClick={() => setStep(2)} disabled={mutation.isPending} className="min-h-11 flex-1 rounded-xl border border-green-300 font-bold text-green-800">{t('common.back')}</button><button type="button" onClick={submit} disabled={mutation.isPending} className="min-h-11 flex-1 rounded-xl bg-green-600 px-3 font-bold text-white disabled:opacity-60">{mutation.isPending ? t('leagueCreate.creating') : t('leagueCreate.create')}</button></div>
          </div>
        ) : null}
        {validationError && step !== 3 ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{validationError}</p> : null}
      </section>
    </div>
  )
}
