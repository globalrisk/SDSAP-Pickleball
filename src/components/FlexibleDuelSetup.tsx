import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useLeague } from '../context/LeagueContext'
import { fetchFlexibleDuelContext, saveFlexibleDuelPlan } from '../lib/leagueTeamDuelApi'
import { FLEXIBLE_DUEL_VERSION, selectNextDuelSplit, validateDuelSettings, type DuelGenerationSettings, type DuelScheduleOption, type DuelSearchCatalog, type DuelSearchInput, type DuelSearchProgress, type DuelSplit, type FlexibleDuelPlan } from '../lib/flexibleDuel'
import type { MatchWithTeams, Season, TeamWithPlayers } from '../types'
import { SeasonForecastSummary } from './SeasonForecastSummary'
import { SeasonMatchDeletion } from './SeasonMatchDeletion'
import { LeagueDuelTeamNameForm } from './LeagueDuelTeamNameForm'
import { ErrorState } from './Layout'
import { teamWinProbability } from '../lib/ratings'
import type { PoolPlayer } from '../types'

const button = 'min-h-11 rounded-lg border border-green-300 px-4 py-2 font-semibold text-green-900 disabled:opacity-50'
export function FlexibleDuelSetup({ season, rosterIds, teams, fixtures, hasFixtures, editable }: {
  season: Season; rosterIds: string[]; teams: TeamWithPlayers[]; fixtures: MatchWithTeams[] | undefined; hasFixtures: boolean; editable: boolean
}) {
  const { t } = useTranslation(), { league, leaguePath } = useLeague(), client = useQueryClient()
  const saved = season.duel_draft_plan
  const orderedTeams = saved ? saved.squads.map(s => teams.find(team => team.players.some(p => p.pool_player_id === s[0]))) : teams
  const [settings, setSettings] = useState<DuelGenerationSettings>(saved?.settings ?? { maxPartnerMeetings: 2, maxOpponentMeetings: 2 })
  const [names, setNames] = useState<[string, string]>([orderedTeams[0]?.name ?? t('leagueDuel.squadA'), orderedTeams[1]?.name ?? t('leagueDuel.squadB')])
  const named = useRef(teams.length > 0)
  useEffect(() => { if (!named.current && orderedTeams[0] && orderedTeams[1]) { named.current = true; setNames([orderedTeams[0].name, orderedTeams[1].name]) } }, [orderedTeams])
  const [catalog, setCatalog] = useState<DuelSearchCatalog | null>(null), [split, setSplit] = useState<DuelSplit | undefined>()
  const [options, setOptions] = useState<DuelScheduleOption[]>([]), [selectedId, setSelectedId] = useState<string>()
  const [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [progress, setProgress] = useState<DuelSearchProgress>(), [elapsed, setElapsed] = useState(0)
  const [hash, setHash] = useState(season.duel_draft_plan_hash ?? null)
  const worker = useRef<Worker | null>(null), requestId = useRef(0), activeKey = useRef(''), seenSplits = useRef<string[]>([]), seenOptions = useRef(new Map<string, string[]>())
  const completed = useRef(new Map<string, DuelSearchCatalog>())
  const context = useQuery({ queryKey: ['flexible-duel-context', season.id, [...rosterIds].sort().join(':')], queryFn: () => fetchFlexibleDuelContext(league.id, season.id), enabled: editable && !hasFixtures && [8, 10, 12, 14].includes(rosterIds.length), staleTime: 0 })
  const actualCount = context.data?.rosterIds.length ?? rosterIds.length, size = actualCount / 2, validSize = [8, 10, 12, 14].includes(actualCount)
  let invalidLimits = false
  if (validSize) { try { validateDuelSettings(size, settings) } catch { invalidLimits = true } }
  const inputKey = context.data ? JSON.stringify([FLEXIBLE_DUEL_VERSION, context.data.key, settings]) : ''
  const input: DuelSearchInput | undefined = context.data ? { pool: context.data.pool, settings, inputKey, partnerHistory: context.data.partnerHistory.map(s => [...s]) } : undefined
  const inputRef = useRef(input); inputRef.current = input
  const selected = options.find(o => o.id === selectedId)
  const optionsRef = useRef(options); optionsRef.current = options
  const splitRef = useRef(split); splitRef.current = split
  const stop = () => { requestId.current++; worker.current?.terminate(); worker.current = null; setBusy(false) }
  useEffect(() => () => { worker.current?.terminate() }, [])
  useEffect(() => {
    if (!inputKey || activeKey.current === inputKey) return
    stop(); activeKey.current = inputKey; seenSplits.current = []; seenOptions.current.clear(); setCatalog(null); setOptions([]); setSplit(undefined); setSelectedId(undefined); setNotice(''); setUnavailable(false)
    if (saved?.inputKey === inputKey && saved.version === FLEXIBLE_DUEL_VERSION) {
      setSplit({ id: saved.splitId, squads: saved.squads, bestWorst: saved.option.metrics.worstFavorite }); setOptions([saved.option]); setSelectedId(saved.option.id)
    }
  // Snapshot changes invalidate results; background fetches of identical data do not.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey])
  useEffect(() => { if (!busy) return; const started = Date.now(); setElapsed(0); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer) }, [busy])
  const requestOptions = (chosen: DuelSplit, refresh = false) => {
    const current = inputRef.current; if (!current || !worker.current) return
    persist.reset(); setBusy(true); setError(''); setProgress({ phase: 'options', completed: 0, total: 1, nodes: 0 }); setSplit(chosen)
    worker.current.postMessage({ type: 'options', requestId: ++requestId.current, input: current, split: chosen, excluded: refresh ? seenOptions.current.get(chosen.id) ?? [] : [], currentIds: optionsRef.current.map(o => o.id) })
  }
  const getWorker = () => {
    if (worker.current) return worker.current
    const w = new Worker(new URL('../lib/flexibleDuel.worker.ts', import.meta.url), { type: 'module' }); worker.current = w
    w.onerror = () => { setError(t('flexibleDuel.workerError')); setBusy(false); setUnavailable(true); w.terminate(); worker.current = null }
    w.onmessage = (event: MessageEvent<{ requestId: number; type: string; progress?: DuelSearchProgress; catalog?: DuelSearchCatalog; options?: DuelScheduleOption[]; splitId?: string; inputKey?: string; restarted?: boolean; message?: string }>) => {
      const message = event.data; if (message.requestId !== requestId.current) return
      if (message.type === 'progress') { setProgress(message.progress); return }
      if (message.type === 'error') { setError(message.message ?? t('flexibleDuel.workerError')); setBusy(false); setUnavailable(true); return }
      if (message.type === 'catalog') {
        const found = message.catalog!; completed.current.set(activeKey.current, found); setCatalog(found)
        const current = splitRef.current
        const chosen = selectNextDuelSplit(found, current, current ? [current.id] : [])
        if (!chosen) { setOptions([]); setSplit(undefined); setNotice('noValid'); setBusy(false); return }
        seenSplits.current = [chosen.id]; requestOptions(chosen); return
      }
      if (message.type === 'options' && message.inputKey === activeKey.current) {
        const found = message.options!; setOptions(found); setSelectedId(found[0]?.id); setBusy(false); setUnavailable(false)
        const key = message.splitId!, seen = message.restarted ? [] : seenOptions.current.get(key) ?? []
        seenOptions.current.set(key, [...new Set([...seen, ...found.map(o => o.id)])])
        setNotice(message.restarted ? 'restarted' : found.length < 3 ? 'fewer' : '')
      }
    }
    return w
  }
  function search() {
    if (!input) return
    persist.reset(); stop(); const w = getWorker(); setBusy(true); setError(''); setNotice(''); setUnavailable(true)
    const cached = completed.current.get(inputKey)
    if (cached) { setCatalog(cached); const chosen = selectNextDuelSplit(cached, split, seenSplits.current); if (chosen) { seenSplits.current.push(chosen.id); requestOptions(chosen) } else { setBusy(false); setNotice('noValid') }; return }
    setProgress({ phase: 'global', completed: 0, total: 0, nodes: 0 }); w.postMessage({ type: 'search', requestId: ++requestId.current, input })
  }
  function shuffle() {
    if (!catalog) { search(); return }
    getWorker(); const chosen = selectNextDuelSplit(catalog, split, seenSplits.current)
    if (!chosen) return
    if (seenSplits.current.includes(chosen.id)) seenSplits.current = [split?.id ?? '']
    seenSplits.current.push(chosen.id); requestOptions(chosen)
  }
  const persist = useMutation({
    mutationFn: async (generate: boolean) => {
      if (!input || !context.data || !split || !selected || busy || unavailable || context.isFetching || context.isError) throw new Error(t('flexibleDuel.selectFirst'))
      const fresh = await fetchFlexibleDuelContext(league.id, season.id)
      if (fresh.key !== context.data.key) { setUnavailable(true); void context.refetch(); throw new Error(t('flexibleDuel.stale')) }
      const plan: FlexibleDuelPlan = { version: FLEXIBLE_DUEL_VERSION, inputKey, splitId: split.id, settings, squads: split.squads, option: selected }
      return saveFlexibleDuelPlan(season.id, plan, names, fresh.revision, fresh.fingerprint, hash, generate)
    },
    onSuccess: async result => { setHash(result.hash); setNotice(result.count ? 'generated' : 'saved'); await Promise.all(['teams', 'teams-with-players', 'matches', 'seasons', 'assigned-pool-players'].map(key => client.invalidateQueries({ queryKey: [key] }))) },
    onError: () => { void context.refetch(); void client.invalidateQueries({ queryKey: ['seasons'] }) },
  })
  useEffect(() => { setHash(season.duel_draft_plan_hash ?? null) }, [season.duel_draft_plan_hash])
  const pool = new Map((context.data?.pool ?? []).map(p => [p.id, p])), playerName = (id: string) => pool.get(id)?.name ?? teams.flatMap(t => t.players).find(p => p.pool_player_id === id)?.name ?? id
  const disabled = busy || unavailable || context.isFetching || context.isError || !selected || persist.isPending || names.some(n => !n.trim())
  return <section className="mb-8 space-y-4 rounded-xl border border-green-200 bg-white p-5">
    <h2 className="text-lg font-bold text-green-950">{t('leagueDuel.title')}</h2>
    <p className="text-sm text-gray-600">{t('flexibleDuel.rules')}</p>
    {hasFixtures ? <>
      <p>{t('leagueDuel.frozen')}</p>
      <div className="grid gap-4 sm:grid-cols-2">{teams.map(team => <div key={team.id}><h3 className="font-bold">{team.name}</h3>{editable ? <LeagueDuelTeamNameForm team={team} disabled={persist.isPending} /> : null}<ul>{team.players.map(p => <li key={p.id}>{p.name}</li>)}</ul></div>)}</div>
      {saved ? <p>{t('flexibleDuel.savedLimits', { partner: saved.settings.maxPartnerMeetings ?? t('flexibleDuel.noLimit'), opponent: saved.settings.maxOpponentMeetings ?? t('flexibleDuel.noLimit') })}</p> : null}
      {editable && fixtures?.length ? <SeasonMatchDeletion season={season} fixtures={fixtures} busy={persist.isPending} onCleared={() => { stop(); setOptions([]); setHash(null) }} /> : null}
      <Link to={leaguePath('/matches')} className="text-green-800 underline">{t('leagueDuel.viewGames')}</Link>
    </> : editable ? <>
      {!validSize ? <p>{t('leagueDuel.rosterSize', { count: rosterIds.length })}</p> : <>
        <div className="grid gap-4 sm:grid-cols-2">{(['maxPartnerMeetings', 'maxOpponentMeetings'] as const).map(field => <label key={field} className="text-sm font-semibold">{t(`flexibleDuel.${field}`)}<select aria-label={t(`flexibleDuel.${field}`)} className="mt-1 block min-h-11 w-full rounded-lg border px-3" value={settings[field] ?? 'none'} disabled={persist.isPending} onChange={e => setSettings(s => ({ ...s, [field]: e.target.value === 'none' ? null : Number(e.target.value) }))}>
          {settings[field] !== null && settings[field]! > size - 1 ? <option value={settings[field]!} disabled>{settings[field]}</option> : null}{Array.from({ length: size - 1 }, (_, i) => i + 1).map(n => <option key={n} value={n} disabled={field === 'maxOpponentMeetings' && n * size < 2 * (size - 1)}>{n}</option>)}<option value="none">{t('flexibleDuel.noLimit')}</option>
        </select></label>)}</div>
        <p className="text-xs text-gray-600">{t('flexibleDuel.limitHelp')}</p>
        {invalidLimits ? <p role="alert" className="text-sm text-red-800">{t('flexibleDuel.invalidLimits')}</p> : null}
        <p className="text-xs">{t('flexibleDuel.participation', { games: size - 1 })} {t('flexibleDuel.seasonBalanceLimit')}</p>
        <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={invalidLimits || !context.data || context.isFetching || busy || persist.isPending} onClick={shuffle}>{t(catalog ? 'flexibleDuel.shuffle' : 'flexibleDuel.search')}</button><button type="button" className={button} disabled={!split || !catalog || busy || persist.isPending} onClick={() => { getWorker(); requestOptions(split!, true) }}>{t('flexibleDuel.refreshSchedules')}</button>{busy ? <button type="button" className={button} onClick={() => { stop(); setUnavailable(true); setNotice('cancelled') }}>{t('flexibleDuel.cancel')}</button> : null}</div>
        {busy ? <div role="status"><p>{t(`flexibleDuel.phase.${progress?.phase ?? 'global'}`, { done: progress?.completed ?? 0, total: progress?.total ?? 0, seconds: elapsed })}</p><p className="text-xs">{t('flexibleDuel.exhaustiveHelp')}</p></div> : null}
        {context.isFetching ? <p role="status">{t('common.loading')}</p> : null}
        {context.error ? <ErrorState message={context.error.message} /> : null}
        {notice ? <p role="status" className="text-sm text-green-900">{t(`flexibleDuel.notice.${notice}`, { count: options.length })}</p> : null}
        {split ? <div className="grid gap-4 sm:grid-cols-2">{split.squads.map((s, side) => <div key={side}><label className="text-sm font-bold">{t(side ? 'leagueDuel.nameB' : 'leagueDuel.nameA')}<input className="mt-1 block min-h-11 w-full rounded-lg border px-3" value={names[side]} maxLength={120} disabled={persist.isPending} onChange={e => { named.current = true; setNames(ns => side === 0 ? [e.target.value, ns[1]] : [ns[0], e.target.value]) }} /></label><ul className="mt-2 text-sm">{s.map(id => <li key={id}>{playerName(id)} <span className="text-gray-500">{pool.get(id) ? Math.round(pool.get(id)!.rating) : ''}</span></li>)}</ul></div>)}</div> : null}
        <div className="grid gap-3 lg:grid-cols-3">{options.map(option => { const m = option.metrics, hardest = [...m.players].sort((a, b) => b.below40 - a.below40 || b.disadvantage - a.disadvantage)[0]!; return <label key={option.id} className={`rounded-lg border p-4 ${selected?.id === option.id ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}>
          <span className="flex gap-2 font-bold"><input type="radio" name={`duel-${season.id}`} checked={selectedId === option.id} disabled={busy || persist.isPending || unavailable} onChange={() => { setSelectedId(option.id); persist.reset() }} />{t(`flexibleDuel.kind.${option.kind}`)}</span>
          <p className="mt-2 text-xs text-gray-600">{t(`flexibleDuel.kindHelp.${option.kind}`)}</p>
          <p className="mt-2">{t('flexibleDuel.matchMetrics', { worst: (100 * m.worstFavorite).toFixed(1), within: m.within60, total: option.games.length, average: (100 * m.averageFavorite).toFixed(1) })}</p>
          <p className="mt-2 text-sm">{t('flexibleDuel.coverage', { covered: m.coveredOpponents, possible: size * size, partners: m.usedPartners })}</p>
          <p className="mt-2 text-sm">{t('flexibleDuel.hardest', { name: playerName(hardest.id), games: hardest.below40 })}</p>
          <p className="mt-2 text-xs">{t('flexibleDuel.actualCaps', { partner: m.maxPartnerMeetings, opponent: m.maxOpponentMeetings })}</p>
          <div className="mt-3"><SeasonForecastSummary forecast={m.forecast} names={names} /></div>
        </label> })}</div>
        {selected && split ? <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">{t('flexibleDuel.details')}</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['game', 'round', 'sideA', 'sideB', 'chance'].map(key => <th key={key} className="p-2">{t(`flexibleDuel.${key}`)}</th>)}</tr></thead><tbody>{selected.games.map(g => { return <tr key={g.sequenceNumber} className="border-t"><td className="p-2">{g.sequenceNumber}</td><td className="p-2">{g.roundNumber}</td><td className="p-2">{g.homePoolPlayerIds.map(playerName).join(' + ')}</td><td className="p-2">{g.awayPoolPlayerIds.map(playerName).join(' + ')}</td><td className="p-2"><GameChance ids={[g.homePoolPlayerIds, g.awayPoolPlayerIds]} pool={context.data?.pool ?? []} /></td></tr> })}</tbody></table></div>
          <h4 className="mt-4 font-semibold">{t('flexibleDuel.playerDetails')}</h4><ul className="space-y-1 text-sm">{selected.metrics.players.map(p => <li key={p.id}>{t('flexibleDuel.playerRow', { name: playerName(p.id), games: p.games, wins: p.expectedWins.toFixed(1), hard: p.below40, partners: p.partners, opponents: p.opponents })}</li>)}</ul>
          <h4 className="mt-4 font-semibold">{t('flexibleDuel.opponentMatrix')}</h4><CountMatrix names={split.squads.map(s => s.map(playerName)) as [string[], string[]]} counts={selected.metrics.opponentCounts} />
          <h4 className="mt-4 font-semibold">{t('flexibleDuel.partnerMatrix')}</h4>{split.squads.map((s, i) => <CountMatrix key={i} names={[s.map(playerName), s.map(playerName)]} counts={selected.metrics.partnerCounts[i]!} />)}
          <p className="mt-3 text-sm">{t('flexibleDuel.missing')} {split.squads[0].flatMap((a, i) => split.squads[1].flatMap((b, j) => selected.metrics.opponentCounts[i]![j] === 0 ? [`${playerName(a)} / ${playerName(b)}`] : [])).join('; ') || t('flexibleDuel.none')}</p>
          <p className="mt-2 text-sm">{t('flexibleDuel.rest', { consecutive: selected.metrics.backToBack, idle: selected.metrics.maxIdleGames })}</p>
        </details> : null}
        <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={disabled} onClick={() => persist.mutate(false)}>{t('leagueDuel.saveDraft')}</button><button type="button" className={`${button} bg-green-700 text-white`} disabled={disabled} onClick={() => persist.mutate(true)}>{t('flexibleDuel.generate', { count: selected?.games.length ?? 0 })}</button></div>
      </>}
    </> : <p>{t('flexibleDuel.adminOnly')}</p>}
    {error || persist.error ? <ErrorState message={persist.error?.message ?? error} /> : null}
    <Link to={leaguePath('/setup?section=season')} className="text-sm text-green-800 underline">{t('setup.seasonRosterManage')}</Link>
  </section>
}

function GameChance({ ids, pool }: { ids: [string[], string[]]; pool: PoolPlayer[] }) {
  if (ids.flat().some(id => !pool.some(p => p.id === id))) return <>—</>
  const skill = (side: number) => ids[side]!.map(id => { const p = pool.find(p => p.id === id)!; return { rating: p.rating, rd: p.rating_deviation, volatility: 0 } })
  const chance = teamWinProbability(skill(0), skill(1))!
  return <>{(chance * 100).toFixed(1)}% / {((1 - chance) * 100).toFixed(1)}%</>
}
function CountMatrix({ names, counts }: { names: [string[], string[]]; counts: number[][] }) {
  return <div className="mt-2 overflow-x-auto"><table className="text-left text-xs"><thead><tr><td />{names[1].map((n, i) => <th scope="col" key={i} className="p-2">{n}</th>)}</tr></thead><tbody>{names[0].map((n, i) => <tr key={i}><th scope="row" className="p-2">{n}</th>{counts[i]!.map((count, j) => <td key={j} className="border p-2">{count}</td>)}</tr>)}</tbody></table></div>
}
