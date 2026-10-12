import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { usePlayerPool } from '../hooks/usePlayerPool'
import { useAuth } from '../context/AuthContext'
import { betErrorMessage, fetchPlayerAccountDirectory, fetchPlayerAccounts, linkPlayerAccount, unlinkPlayerAccount } from '../lib/betsApi'
import { useConfirm } from '../lib/confirmation'
import { Select } from './Select'
import { ErrorState } from './Layout'

export function PlayerAccountLinks() {
  const { t } = useTranslation()
  const { league } = useLeague()
  const { user, isAdmin } = useAuth()
  const pool = usePlayerPool()
  const client = useQueryClient()
  const confirm = useConfirm()
  const [playerId, setPlayerId] = useState('')
  const [email, setEmail] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => { if (showLinkForm) formRef.current?.scrollIntoView({ block: 'nearest' }) }, [showLinkForm])
  const accounts = useQuery({ queryKey: ['player-account-links', league.id, user?.id], queryFn: () => fetchPlayerAccounts(league.id), enabled: isAdmin })
  const directory = useQuery({ queryKey: ['player-account-directory', user?.id, search, offset], queryFn: () => fetchPlayerAccountDirectory(search, offset), enabled: isAdmin && directoryOpen })
  const refreshAccounts = () => Promise.all(['player-account-links', 'player-account', 'player-account-directory', 'bets'].map(key => client.invalidateQueries({ queryKey: [key] })))
  const save = useMutation({ mutationFn: () => linkPlayerAccount(playerId, email), onSuccess: async () => {
    setEmail(''); setPlayerId(''); setShowLinkForm(false)
    await refreshAccounts()
  } })
  const unlink = useMutation({
    mutationFn: (account: { playerId: string; email: string; requestId: string }) => unlinkPlayerAccount(account.playerId, account.email, account.requestId),
    onSuccess: refreshAccounts,
  })
  async function confirmUnlink(account: { playerId: string; email: string; name: string }) {
    if (save.isPending || unlink.isPending) return
    if (!await confirm(t('bets.unlinkConfirm', { email: account.email, name: account.name }), { title: t('bets.unlinkAccount'), confirmLabel: t('bets.unlinkAccount'), tone: 'danger' })) return
    save.reset()
    unlink.mutate({ ...account, requestId: crypto.randomUUID() })
  }
  if (!isAdmin) return null
  return <section className="mb-6 rounded-xl border border-green-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold text-green-950">{t('workspace.linkedAccounts')}</h2>
      <button type="button" aria-expanded={showLinkForm} aria-controls="player-account-form" onClick={() => setShowLinkForm(value => !value)} className="min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">{t(showLinkForm ? 'common.close' : 'bets.linkAccount')}</button>
    </div>
    <p className="mt-2 text-sm text-gray-600">{t('workspace.accountLinksHelp')}</p>
    {accounts.isLoading ? <p>{t('common.loading')}</p> : accounts.error ? <ErrorState message={betErrorMessage(accounts.error, t)} /> : <>
      {showLinkForm ? <form id="player-account-form" ref={formRef} className="mt-4 grid gap-3 rounded-lg bg-green-50 p-4 lg:grid-cols-2 lg:items-end" onSubmit={e => { e.preventDefault(); if (save.isPending || unlink.isPending) return; unlink.reset(); save.mutate() }}>
        <label className="text-sm font-semibold">{t('bets.player')}<Select value={playerId} onValueChange={setPlayerId} className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3">
          <option value="">{t('personal.chooseName')}</option>
          {(pool.data ?? []).filter(p => !accounts.data?.some(a => a.player_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select></label>
        <label className="text-sm font-semibold">{t('bets.email')}<input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3" /></label>
        <button disabled={!playerId || save.isPending || unlink.isPending} className="min-h-11 rounded-lg bg-green-700 px-4 font-bold text-white disabled:opacity-50">{t('bets.linkAccount')}</button>
      </form> : null}
      <ul className="mt-4 space-y-2 text-sm">{accounts.data?.map(a => <li key={a.player_id} className="rounded-lg border border-green-100"><details><summary className="flex min-h-14 cursor-pointer items-center gap-3 p-3"><div className="min-w-0 flex-1"><strong className="break-words">{pool.data?.find(p => p.id === a.player_id)?.name}</strong><p className="break-all text-gray-600">{a.email}</p></div><span aria-hidden="true" className="text-green-700">⌄</span></summary><div className="border-t border-green-100 p-3"><button type="button" disabled={save.isPending || unlink.isPending} onClick={() => void confirmUnlink({ playerId: a.player_id, email: a.email, name: pool.data?.find(p => p.id === a.player_id)?.name ?? a.email })} className="min-h-11 rounded-lg border border-red-200 px-3 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">{t('bets.unlinkAccount')}</button></div></details></li>)}</ul>
      {!accounts.data?.length ? <p className="mt-4 text-sm text-gray-600">{t('workspace.noLinkedAccounts')}</p> : null}
    </>}
    {save.error ? <ErrorState message={betErrorMessage(save.error, t)} /> : save.isSuccess ? <p role="status" className="mt-2 text-sm text-green-800">{t('bets.linked')}</p> : null}
    {unlink.error ? <ErrorState message={betErrorMessage(unlink.error, t)} /> : unlink.isSuccess ? <p role="status" className="mt-2 text-sm text-green-800">{t('bets.unlinkedAccount')}</p> : null}
    <details open={directoryOpen} onToggle={event => setDirectoryOpen(event.currentTarget.open)} className="mt-6 border-t border-green-100 pt-5">
      <summary className="min-h-11 cursor-pointer font-bold text-green-950">{t('bets.registeredAccounts')}</summary>
      <p className="mt-1 text-sm text-gray-600">{t('bets.registeredAccountsHelp')}</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setSearch(searchInput.trim()); setOffset(0) }}>
        <label className="min-w-0 flex-1 text-sm font-semibold">
          {t('bets.searchEmail')}
          <input type="search" autoComplete="off" value={searchInput} onChange={event => setSearchInput(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3" />
        </label>
        <button type="submit" className="min-h-11 rounded-lg border border-green-200 px-4 text-sm font-bold text-green-800">{t('bets.searchAccounts')}</button>
        <button type="button" disabled={directory.isFetching} onClick={() => void directory.refetch()} className="min-h-11 rounded-lg border border-green-200 px-4 text-sm font-bold text-green-800 disabled:opacity-50">{t('bets.refreshAccounts')}</button>
      </form>
      {directory.isLoading ? <p role="status" className="mt-3">{t('common.loading')}</p> : directory.error ? <ErrorState message={betErrorMessage(directory.error, t)} /> : <>
        <ul className="mt-3 space-y-2 text-sm">{directory.data?.accounts.map(account => <li key={account.email} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-100 p-3">
          <div className="min-w-0"><p className="break-all font-semibold text-green-950">{account.email}</p><p className="mt-1 break-words text-xs text-gray-600">{account.playerId ? t('bets.linkedToPlayer', { name: account.playerName }) : t('bets.accountNotLinked')}</p></div>
          {!account.playerId ? <button type="button" onClick={() => { setEmail(account.email); setShowLinkForm(true); if (showLinkForm) formRef.current?.scrollIntoView({ block: 'nearest' }) }} className="min-h-11 rounded-lg bg-green-50 px-3 font-bold text-green-800">{t('bets.useEmail')}</button> : <button type="button" disabled={save.isPending || unlink.isPending} onClick={() => void confirmUnlink({ playerId: account.playerId!, email: account.email, name: account.playerName ?? account.email })} className="min-h-11 rounded-lg border border-red-200 px-3 font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">{t('bets.unlinkAccount')}</button>}
        </li>)}</ul>
        {!directory.data?.accounts.length ? <p className="mt-3 text-sm text-gray-600">{t('bets.noRegisteredAccounts')}</p> : null}
        <nav aria-label={t('bets.accountPages')} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 25))} className="min-h-11 rounded-lg border border-green-200 px-3 font-semibold disabled:opacity-40">{t('bets.previousAccounts')}</button>
          <span>{t('bets.accountPage', { page: Math.floor(offset / 25) + 1, count: directory.data?.total ?? 0 })}</span>
          <button type="button" disabled={offset + 25 >= (directory.data?.total ?? 0)} onClick={() => setOffset(value => value + 25)} className="min-h-11 rounded-lg border border-green-200 px-3 font-semibold disabled:opacity-40">{t('bets.nextAccounts')}</button>
        </nav>
      </>}
    </details>
  </section>
}
