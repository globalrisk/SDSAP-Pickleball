import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useMatches } from '../hooks/useMatches'
import { usePlayerPool } from '../hooks/usePlayerPool'
import { useTeamsWithPlayers } from '../hooks/useTeams'
import { useConfirm } from '../lib/confirmation'
import { replaceLeagueDuelMatchPlayer } from '../lib/leagueTeamDuelApi'
import type { MatchWithTeams } from '../types'

const buttonClass = 'min-h-11 rounded-lg border border-green-200 px-3 text-sm font-semibold text-green-800 hover:bg-green-50 disabled:opacity-50'
const selectClass = 'mt-1 min-h-11 w-full rounded-lg border border-green-200 bg-white px-2 text-base font-normal sm:text-sm'

export function DuelMatchPlayerReplacement({ match }: { match: MatchWithTeams }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (open || !restoreFocus.current) return
    restoreFocus.current = false
    trigger.current?.focus()
  }, [open])
  return (
    <div className="mt-4">
      {open ? (
        <ReplacementForm match={match} onClose={(changed) => {
          setOpen(false)
          setSaved(changed)
        }} />
      ) : (
        <button ref={trigger} type="button" className={buttonClass} onClick={() => {
          restoreFocus.current = true
          setOpen(true)
          setSaved(false)
        }}>{t('matchReplacement.action')}</button>
      )}
      {saved ? <p className="mt-2 text-sm text-green-800" role="status">{t('matchReplacement.saved')}</p> : null}
    </div>
  )
}

function ReplacementForm({ match, onClose }: {
  match: MatchWithTeams
  onClose: (changed: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const confirm = useConfirm()
  const client = useQueryClient()
  const teams = useTeamsWithPlayers()
  const pool = usePlayerPool()
  const seasonMatches = useMatches(match.season_id)
  const lineup = [...(match.home_team.players ?? []), ...(match.away_team.players ?? [])]
  const missing = lineup.filter((player) => !player.is_present)
  const [outgoingId, setOutgoingId] = useState(() => missing.length === 1 ? missing[0].pool_player_id : '')
  const [incomingId, setIncomingId] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const selectOutgoing = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    selectOutgoing.current?.focus()
  }, [])
  const outgoing = lineup.find((player) => player.pool_player_id === outgoingId)
  const outgoingTeamId = outgoing && (match.home_pool_player_ids?.includes(outgoingId) ? match.home_team_id : match.away_team_id)
  const onCourt = new Set(seasonMatches.data?.flatMap((fixture) =>
    fixture.status === 'scheduled' && fixture.live_status === 'playing'
      ? [...(fixture.home_pool_player_ids ?? []), ...(fixture.away_pool_player_ids ?? [])]
      : [],
  ))
  const inMatch = new Set([...(match.home_pool_player_ids ?? []), ...(match.away_pool_player_ids ?? [])])
  const active = new Set(pool.data?.filter((player) => player.status === 'active').map((player) => player.id))
  const candidates = (teams.data?.find((team) => team.id === outgoingTeamId)?.players ?? [])
    .filter((player) => active.has(player.pool_player_id) && !inMatch.has(player.pool_player_id) && !onCourt.has(player.pool_player_id))
    .sort((a, b) => Number(b.is_present) - Number(a.is_present) || a.name.localeCompare(b.name, i18n.language))
  const incoming = candidates.find((player) => player.pool_player_id === incomingId)
  const loading = teams.isPending || pool.isPending || seasonMatches.isPending
  const queryError = teams.isError || pool.isError || seasonMatches.isError

  const replacement = useMutation({
    mutationFn: ({ from, to, home, away }: { from: string; to: string; home: string[]; away: string[] }) =>
      replaceLeagueDuelMatchPlayer(match.id, from, to, home, away),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['matches', match.season_id] }),
        client.invalidateQueries({ queryKey: ['bets'] }),
        client.invalidateQueries({ queryKey: ['pickle-points'] }),
        client.invalidateQueries({ queryKey: ['pickle-preview', match.season_id] }),
      ])
      onClose(true)
    },
    onError: (error: { message?: string }) => {
      const code = error.message?.split(':', 1)[0]
      if (code === 'DUEL_SUB_STALE' || code === 'DUEL_SUB_BUSY' || code === 'DUEL_SUB_LOCKED' || code === 'DUEL_SUB_INELIGIBLE') {
        setErrorKey(`matchReplacement.errors.${code}`)
        setIncomingId('')
        void client.invalidateQueries({ queryKey: ['matches', match.season_id] })
        void client.invalidateQueries({ queryKey: ['teams-with-players', match.season_id] })
        void client.invalidateQueries({ queryKey: ['player-pool'] })
      } else {
        setErrorKey('matchReplacement.errors.generic')
        void client.invalidateQueries({ queryKey: ['matches', match.season_id] })
      }
    },
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (replacement.isPending || !outgoing || !incoming || !match.home_pool_player_ids || !match.away_pool_player_ids) return
    const reviewed = {
      from: outgoing.pool_player_id, to: incoming.pool_player_id,
      home: match.home_pool_player_ids, away: match.away_pool_player_ids,
    }
    const accepted = await confirm(t('matchReplacement.confirm', { outgoing: outgoing.name, incoming: incoming.name }), {
      title: t('matchReplacement.action'),
      confirmLabel: t('matchReplacement.action'),
    })
    if (!accepted) return
    setErrorKey(null)
    replacement.mutate(reviewed)
  }

  return (
    <form
      aria-label={t('matchReplacement.action')}
      className="space-y-3 rounded-xl border border-green-200 bg-green-50/50 p-3"
      onSubmit={submit}
    >
      <div className="grid gap-3 text-sm font-medium text-green-950 sm:grid-cols-2">
        <label>
          {t('matchReplacement.outgoing')}
          <select
            ref={selectOutgoing}
            className={selectClass}
            value={outgoing?.pool_player_id ?? ''}
            disabled={replacement.isPending}
            onChange={(event) => {
              setOutgoingId(event.target.value)
              setIncomingId('')
              setErrorKey(null)
            }}
          >
            <option value="">{t('matchReplacement.selectPlayer')}</option>
            {lineup.map((player) => (
              <option key={player.pool_player_id} value={player.pool_player_id}>
                {player.name} · {t(player.is_present ? 'live.present' : 'live.notPresent')}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('matchReplacement.incoming')}
          <select
            className={selectClass}
            value={incoming?.pool_player_id ?? ''}
            disabled={!outgoing || loading || queryError || replacement.isPending}
            onChange={(event) => {
              setIncomingId(event.target.value)
              setErrorKey(null)
            }}
          >
            <option value="">{t('matchReplacement.selectPlayer')}</option>
            {candidates.map((player) => (
              <option key={player.pool_player_id} value={player.pool_player_id}>
                {player.name} · {t(player.is_present ? 'live.present' : 'live.notPresent')}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? <p role="status" className="text-sm text-gray-700">{t('common.loading')}</p> : null}
      {!loading && !queryError && outgoing && candidates.length === 0
        ? <p className="text-sm text-gray-700">{t('matchReplacement.noTeammates')}</p> : null}
      {errorKey || queryError ? <p role="alert" className="text-sm text-red-800">
        {t(errorKey ?? 'matchReplacement.errors.load')}
      </p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
          disabled={!outgoing || !incoming || loading || queryError || replacement.isPending}
        >{t(replacement.isPending ? 'matchReplacement.saving' : 'matchReplacement.action')}</button>
        <button type="button" className={buttonClass} disabled={replacement.isPending} onClick={() => onClose(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
