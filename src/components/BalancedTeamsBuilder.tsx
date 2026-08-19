import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  evaluateBalancedTeams,
  generateBalancedTeamOptions,
  type BalancedTeam,
} from '../lib/balanceTeams'
import { roundRating } from '../lib/ratings'
import type { PoolPlayer } from '../types'

interface BalancedTeamsBuilderProps {
  players: PoolPlayer[]
  partnershipCounts: ReadonlyMap<string, number>
  isHistoryLoading: boolean
  isPending: boolean
  onCreate: (teams: BalancedTeam[]) => void
}

function copyTeams(teams: BalancedTeam[]): BalancedTeam[] {
  return teams.map((team) => ({
    ...team,
    poolPlayerIds: [...team.poolPlayerIds],
    playerNames: [...team.playerNames],
  }))
}

export function BalancedTeamsBuilder({
  players,
  partnershipCounts,
  isHistoryLoading,
  isPending,
  onCreate,
}: BalancedTeamsBuilderProps) {
  const { t } = useTranslation()
  const [excludedPlayerId, setExcludedPlayerId] = useState('')
  const [options, setOptions] = useState<ReturnType<typeof generateBalancedTeamOptions>>([])
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [draftTeams, setDraftTeams] = useState<BalancedTeam[]>([])

  const hasOddPlayer = players.length % 2 !== 0
  const validExcludedPlayerId = players.some((player) => player.id === excludedPlayerId)
    ? excludedPlayerId
    : ''
  const eligiblePlayers = useMemo(
    () => players.filter((player) => player.id !== validExcludedPlayerId),
    [players, validExcludedPlayerId],
  )
  const ratedPlayers = useMemo(
    () =>
      eligiblePlayers.map((player) => ({
        id: player.id,
        name: player.name,
        rating: player.rating,
        ratingDeviation: player.rating_deviation,
      })),
    [eligiblePlayers],
  )
  const playerById = useMemo(
    () => new Map(eligiblePlayers.map((player) => [player.id, player])),
    [eligiblePlayers],
  )
  const summary = useMemo(
    () =>
      draftTeams.length > 0
        ? evaluateBalancedTeams(draftTeams, ratedPlayers, partnershipCounts)
        : null,
    [draftTeams, ratedPlayers, partnershipCounts],
  )

  function generateOptions() {
    const generated = generateBalancedTeamOptions(ratedPlayers, partnershipCounts, 3)
    setOptions(generated)
    setSelectedOptionId(generated[0]?.id ?? '')
    setDraftTeams(generated[0] ? copyTeams(generated[0].teams) : [])
  }

  function selectOption(optionId: string) {
    const option = options.find((candidate) => candidate.id === optionId)
    if (!option) return
    setSelectedOptionId(option.id)
    setDraftTeams(copyTeams(option.teams))
  }

  function swapPlayer(teamIndex: number, slotIndex: 0 | 1, nextPlayerId: string) {
    const currentPlayerId = draftTeams[teamIndex]?.poolPlayerIds[slotIndex]
    if (!currentPlayerId || currentPlayerId === nextPlayerId) return
    const otherTeamIndex = draftTeams.findIndex((team) => team.poolPlayerIds.includes(nextPlayerId))
    if (otherTeamIndex < 0) return
    const otherSlotIndex = draftTeams[otherTeamIndex]!.poolPlayerIds.indexOf(nextPlayerId) as 0 | 1

    setDraftTeams((current) => {
      const next = copyTeams(current)
      next[teamIndex]!.poolPlayerIds[slotIndex] = nextPlayerId
      next[otherTeamIndex]!.poolPlayerIds[otherSlotIndex] = currentPlayerId
      for (const team of next) {
        const first = playerById.get(team.poolPlayerIds[0])!
        const second = playerById.get(team.poolPlayerIds[1])!
        team.playerNames = [first.name, second.name]
        team.teamRating = first.rating + second.rating
      }
      return next
    })
    setSelectedOptionId('')
  }

  const canGenerate =
    !isHistoryLoading &&
    eligiblePlayers.length >= 4 &&
    (!hasOddPlayer || validExcludedPlayerId !== '')

  return (
    <div className="mt-4 space-y-4">
      {hasOddPlayer ? (
        <label className="block text-sm font-medium text-blue-950">
          {t('setup.balancedTeamsSitOutLabel')}
          <select
            value={validExcludedPlayerId}
            onChange={(event) => {
              setExcludedPlayerId(event.target.value)
              setOptions([])
              setDraftTeams([])
            }}
            className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-base"
          >
            <option value="">{t('setup.balancedTeamsSitOutPlaceholder')}</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name} · {roundRating(player.rating)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-blue-800">
            {t('setup.balancedTeamsSitOutHint')}
          </span>
        </label>
      ) : null}

      {eligiblePlayers.length < 4 ? (
        <p className="text-sm text-amber-800">{t('setup.balancedTeamsNeedFour')}</p>
      ) : null}

      <button
        type="button"
        onClick={generateOptions}
        disabled={!canGenerate || isPending}
        className="min-h-11 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 sm:w-auto"
      >
        {isHistoryLoading
          ? t('setup.balancedTeamsLoadingHistory')
          : options.length > 0
          ? t('setup.balancedTeamsRegenerate')
          : t('setup.balancedTeamsPreviewButton', { count: eligiblePlayers.length / 2 })}
      </button>

      {options.length > 0 ? (
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-blue-950">
              {t('setup.balancedTeamsChooseOption')}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {options.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectOption(option.id)}
                  aria-pressed={selectedOptionId === option.id}
                  className={`min-h-11 rounded-lg border px-3 py-3 text-left text-sm ${
                    selectedOptionId === option.id
                      ? 'border-blue-600 bg-blue-100 text-blue-950 ring-2 ring-blue-300'
                      : 'border-blue-200 bg-white text-blue-900'
                  }`}
                >
                  <span className="block font-semibold">
                    {t('setup.balancedTeamsOption', { number: index + 1 })}
                  </span>
                  <span className="mt-1 block text-xs">
                    {t('setup.balancedTeamsOptionStats', {
                      fairness: option.fairnessPercent,
                      repeats: option.repeatedPartnerships,
                    })}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-blue-950">
                  {t('setup.balancedTeamsPreviewTitle')}
                </h4>
                <p className="text-xs text-blue-800">{t('setup.balancedTeamsSwapHint')}</p>
              </div>
              {summary ? (
                <p className="text-xs font-medium text-blue-900">
                  {t('setup.balancedTeamsOptionStats', {
                    fairness: summary.fairnessPercent,
                    repeats: summary.repeatedPartnerships,
                  })}
                </p>
              ) : null}
            </div>

            <div className="mt-3 space-y-3">
              {draftTeams.map((team, teamIndex) => (
                <div key={teamIndex} className="rounded-lg border border-blue-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-blue-950">
                      {t('setup.balancedTeamsTeam', { number: teamIndex + 1 })}
                    </span>
                    <span className="text-xs text-blue-700">
                      {t('setup.balancedTeamsAverage', {
                        rating: roundRating(team.teamRating / 2),
                      })}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([0, 1] as const).map((slotIndex) => (
                      <select
                        key={slotIndex}
                        value={team.poolPlayerIds[slotIndex]}
                        onChange={(event) => swapPlayer(teamIndex, slotIndex, event.target.value)}
                        aria-label={t('setup.balancedTeamsPlayerSlot', {
                          team: teamIndex + 1,
                          slot: slotIndex + 1,
                        })}
                        className="min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-base sm:text-sm"
                      >
                        {eligiblePlayers.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name} · {roundRating(player.rating)}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onCreate(draftTeams)}
            disabled={isPending || draftTeams.length === 0}
            className="min-h-11 w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50"
          >
            {isPending
              ? t('setup.balancedTeamsGenerating')
              : t('setup.balancedTeamsCreateButton', { count: draftTeams.length })}
          </button>
        </div>
      ) : null}
    </div>
  )
}
