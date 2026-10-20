import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { renameMyPlayer } from '../lib/playerNameApi'

export function PlayerNameForm({ playerId, playerName }: { playerId: string; playerName: string }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const client = useQueryClient()
  const [name, setName] = useState(playerName)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending || !user) return
    setSaved(false)
    setError(null)
    const trimmed = name.trim()
    if (!trimmed || Array.from(trimmed).length > 120) {
      setError(t('me.playerNameInvalid'))
      return
    }
    setPending(true)
    try {
      const account = await renameMyPlayer(playerId, trimmed)
      setName(account.name)
      setSaved(true)
      // Update the header/menu immediately and refresh names in every league.
      // Cancel older identity reads so they cannot restore the pre-save name.
      await client.cancelQueries({ queryKey: ['player-account', user.id] })
      client.setQueryData(['player-account', user.id], account)
      await Promise.all([
        'player-account', 'player-pool', 'shared-player-identities', 'player-rankings',
        'player-profile', 'teams-with-players', 'matches', 'season-recap',
        'bets', 'pickle-points', 'pickle-preview', 'team-duel', 'league-duel-draft',
      ].map(key => client.invalidateQueries({ queryKey: [key] })))
    } catch (failure) {
      const code = (failure as { code?: string }).code
      setError(t(code === '22023' ? 'me.playerNameInvalid' : code === '42501' ? 'me.playerNameLinkChanged' : 'me.playerNameError'))
      if (code === '42501') void client.invalidateQueries({ queryKey: ['player-account', user.id] })
    } finally { setPending(false) }
  }

  return <form onSubmit={event => void save(event)} className="mt-5 space-y-3 border-t border-green-100 pt-4">
    <label htmlFor="my-player-name" className="block text-sm font-semibold text-green-950">{t('me.playerName')}</label>
    <input id="my-player-name" type="text" required autoComplete="nickname" disabled={pending} value={name}
      onChange={event => { setName(event.target.value); setSaved(false); setError(null) }}
      aria-describedby="my-player-name-help" aria-invalid={error ? true : undefined}
      className="min-h-11 w-full rounded-lg border border-green-200 px-3 text-base focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-60" />
    <p id="my-player-name-help" className="text-xs text-gray-600">{t('me.playerNameHelp')}</p>
    <button type="submit" disabled={pending || name.trim() === playerName}
      className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white hover:bg-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-50">
      {t(pending ? 'common.loading' : 'me.savePlayerName')}
    </button>
    {saved ? <p role="status" className="text-sm font-semibold text-green-700">{t('me.playerNameSaved')}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </form>
}
