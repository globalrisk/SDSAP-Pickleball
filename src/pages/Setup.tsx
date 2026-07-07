import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { resetAllMatches, saveTeamWithPlayers } from '../lib/api'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { useMatches } from '../hooks/useMatches'
import { useTeamsWithPlayers } from '../hooks/useTeams'

export function SetupPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: teams, isError, error } = useTeamsWithPlayers()
  const { data: matches } = useMatches()
  const [saved, setSaved] = useState<string | null>(null)

  const recordedCount = (matches ?? []).filter(
    (m) => m.status === 'completed' || m.status === 'forfeit',
  ).length

  const saveTeamMutation = useMutation({
    mutationFn: ({
      teamId,
      teamName,
      players,
    }: {
      teamId: string
      teamName: string
      players: { id: string; name: string }[]
    }) => saveTeamWithPlayers(teamId, teamName, players),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      queryClient.invalidateQueries({ queryKey: ['teams-with-players'] })
      setSaved(t('setup.teamUpdated'))
    },
    onError: (err: Error) => setSaved(t('setup.saveFailed', { message: err.message })),
  })

  const resetMutation = useMutation({
    mutationFn: resetAllMatches,
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      setSaved(
        count === 0
          ? t('setup.resetNone')
          : t('setup.resetSuccess', { count }),
      )
    },
    onError: (err: Error) =>
      setSaved(t('setup.resetFailed', { message: err.message })),
  })

  function handleResetMatches() {
    if (recordedCount === 0) {
      setSaved(t('setup.resetNone'))
      return
    }
    if (!confirm(t('setup.resetConfirm', { count: recordedCount }))) return
    resetMutation.mutate()
  }

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <SetupBanner />
      <PageHeader title={t('setup.title')} subtitle={t('setup.subtitle')} />

      {saved && (
        <p className="mb-4 rounded-lg bg-green-100 px-3 py-2 text-sm text-green-800">
          {saved}
        </p>
      )}

      <section className="mb-8 rounded-xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-red-800">{t('setup.resetTitle')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('setup.resetDescription')}</p>
        <p className="mt-2 text-sm font-medium text-gray-700">
          {t('setup.recordedCount', { count: recordedCount })}
        </p>
        <button
          type="button"
          onClick={handleResetMatches}
          disabled={resetMutation.isPending || recordedCount === 0}
          className="mt-4 min-h-11 w-full rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-100 active:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2"
        >
          {resetMutation.isPending ? t('setup.resetting') : t('setup.resetButton')}
        </button>
      </section>

      <div className="space-y-6">
        {(teams ?? []).map((team) => (
          <form
            key={team.id}
            className="rounded-xl border border-green-200 bg-white p-5 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault()
              const form = e.currentTarget
              const teamName = (form.elements.namedItem('teamName') as HTMLInputElement).value
              const players = team.players.map((player) => ({
                id: player.id,
                name: (
                  form.elements.namedItem(`player-${player.id}`) as HTMLInputElement
                ).value,
              }))
              saveTeamMutation.mutate({ teamId: team.id, teamName, players })
            }}
          >
            <input
              name="teamName"
              defaultValue={team.name}
              className="mb-4 min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base font-medium sm:text-sm"
            />

            <div className="space-y-2">
              {team.players.map((player) => (
                <input
                  key={player.id}
                  name={`player-${player.id}`}
                  defaultValue={player.name}
                  className="min-h-11 w-full rounded-lg border border-green-200 px-3 py-2 text-base sm:text-sm"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={saveTeamMutation.isPending}
              className="mt-4 min-h-11 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50 sm:py-2"
            >
              {t('setup.saveTeam')}
            </button>
          </form>
        ))}
      </div>
    </div>
  )
}
