import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorState, LoadingState, PageHeader, SetupBanner } from '../components/Layout'
import { createSharedPlayer, fetchSharedPlayerIdentities } from '../lib/leagueApi'
import { teamDuelPlayersQueryKey } from '../lib/teamDuelApi'

const sharedPlayersQueryKey = ['shared-player-identities'] as const

export function PlayersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [createdName, setCreatedName] = useState<string | null>(null)
  const playersQuery = useQuery({ queryKey: sharedPlayersQueryKey, queryFn: fetchSharedPlayerIdentities })
  const createMutation = useMutation({
    mutationFn: createSharedPlayer,
    onSuccess: async (_, playerName) => {
      setName('')
      setSearch(playerName)
      setCreatedName(playerName)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sharedPlayersQueryKey }),
        queryClient.invalidateQueries({ queryKey: teamDuelPlayersQueryKey }),
      ])
    },
  })
  const players = playersQuery.data ?? []
  const matchingNames = players.filter((player) =>
    player.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  )
  const visiblePlayers = players.filter((player) =>
    (!unassignedOnly || player.leagueNames.length === 0)
    && player.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  )

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName.length > 120) return
    setCreatedName(null)
    createMutation.mutate(trimmedName)
  }

  return (
    <div className="space-y-6">
        <SetupBanner />
        <PageHeader title={t('players.title')} subtitle={t('players.subtitle')} />
        <section className="rounded-2xl border border-green-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-green-950">{t('players.addTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('players.addHelp')}</p>
          <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-semibold text-gray-800">
              {t('players.name')}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3 text-base focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-100"
              />
            </label>
            <button type="submit" disabled={!name.trim() || createMutation.isPending} className="min-h-11 rounded-lg bg-green-700 px-5 py-2 font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50">
              {createMutation.isPending ? t('players.adding') : t('players.add')}
            </button>
          </form>
          {matchingNames.length > 0 ? (
            <p className="mt-3 text-sm text-amber-800" role="status">{t('players.existingName')}</p>
          ) : null}
          {createdName ? (
            <p className="mt-3 text-sm font-semibold text-green-800" role="status">{t('players.created', { name: createdName })}</p>
          ) : null}
          {createMutation.error ? <div className="mt-3"><ErrorState message={(createMutation.error as Error).message} /></div> : null}
        </section>

        <section className="rounded-2xl border border-green-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-green-950">{t('players.directory')}</h2>
              <p className="text-sm text-gray-600">{t('players.directoryHelp')}</p>
            </div>
            <label className="text-sm font-semibold text-gray-800">
              {t('players.search')}
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block min-h-11 rounded-lg border border-green-200 px-3 text-base focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-100" />
            </label>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-green-900">
            <input type="checkbox" checked={unassignedOnly} onChange={(event) => setUnassignedOnly(event.target.checked)} className="size-4 accent-green-700" />
            {t('players.unassignedOnly')}
          </label>
          {playersQuery.isLoading ? <LoadingState /> : null}
          {playersQuery.error ? <div className="mt-4"><ErrorState message={(playersQuery.error as Error).message} /></div> : null}
          {playersQuery.isSuccess ? (
            <div className="mt-4 divide-y divide-green-100 border-t border-green-100">
              {visiblePlayers.map((player) => (
                <div key={player.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="font-semibold text-gray-900">{player.name}</span>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {player.status === 'inactive' ? <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">{t('players.inactive')}</span> : null}
                    <span className={`rounded-full px-2 py-1 ${player.leagueNames.length === 0 ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-900'}`}>
                      {player.leagueNames.length === 0 ? t('players.noLeague') : player.leagueNames.join(', ')}
                    </span>
                  </div>
                </div>
              ))}
              {visiblePlayers.length === 0 ? <p className="py-5 text-sm text-gray-600">{t('players.empty')}</p> : null}
            </div>
          ) : null}
        </section>
    </div>
  )
}
