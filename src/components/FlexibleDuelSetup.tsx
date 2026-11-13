import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useLeague } from '../context/LeagueContext'
import { fetchFlexibleDuelContext, saveFlexibleDuelPlan } from '../lib/leagueTeamDuelApi'
import { FLEXIBLE_DUEL_VERSION, hasUniqueDuelMatchups, isCurrentDuelPlan, isDuelRatingDifferenceAllowed, validateDuelSettings, type DuelGenerationSettings, type DuelScheduleOption, type DuelSearchInput, type DuelSplit, type FlexibleDuelPlan } from '../lib/flexibleDuel'
import type { MatchWithTeams, Season, TeamWithPlayers } from '../types'
import { SeasonForecastSummary } from './SeasonForecastSummary'
import { SeasonMatchDeletion } from './SeasonMatchDeletion'
import { LeagueDuelTeamNameForm } from './LeagueDuelTeamNameForm'
import { TeamColorField } from './TeamColorField'
import { DEFAULT_TEAM_COLORS } from '../lib/teamColors'
import { ErrorState } from './Layout'
import { teamWinProbability } from '../lib/ratings'
import type { PoolPlayer } from '../types'
import { createDuelFeasibilityState, findFeasibleDuelSquads } from '../lib/fastDuelSearch'
import { requestFastDuel } from '../lib/fastDuelApi'

const button = 'min-h-11 rounded-lg border border-green-300 px-4 py-2 font-semibold text-green-900 disabled:opacity-50'
export function FlexibleDuelSetup({ season, rosterIds, teams, fixtures, hasFixtures, editable }: {
  season: Season; rosterIds: string[]; teams: TeamWithPlayers[]; fixtures: MatchWithTeams[] | undefined; hasFixtures: boolean; editable: boolean
}) {
  const { t } = useTranslation(), { league, leaguePath } = useLeague(), client = useQueryClient()
  const saved = season.duel_draft_plan
  const [fastProfile, setFastProfile] = useState('balance')
  const [squadProgress, setSquadProgress] = useState<{ checked: number; total: number }>()
  const feasibility = useRef(createDuelFeasibilityState())
  const abort = useRef<AbortController | null>(null)
  const orderedTeams = saved ? saved.squads.map(s => teams.find(team => team.players.some(p => p.pool_player_id === s[0]))) : teams
  const [settings, setSettings] = useState<DuelGenerationSettings>({ maxPartnerMeetings: 2, maxOpponentMeetings: 3, ...saved?.settings, maxMatchProbability: saved?.settings.maxMatchProbability ?? .65, maxRatingDifference: saved?.settings.maxRatingDifference ?? null })
  const [names, setNames] = useState<[string, string]>([orderedTeams[0]?.name ?? t('leagueDuel.squadA'), orderedTeams[1]?.name ?? t('leagueDuel.squadB')])
  const named = useRef(teams.length > 0)
  const [colorDraft, setColors] = useState<[string, string] | null>(null)
  const colors: [string, string] = colorDraft ?? [orderedTeams[0]?.color ?? DEFAULT_TEAM_COLORS[0], orderedTeams[1]?.color ?? DEFAULT_TEAM_COLORS[1]]
  useEffect(() => { if (!named.current && orderedTeams[0] && orderedTeams[1]) { named.current = true; setNames([orderedTeams[0].name, orderedTeams[1].name]) } }, [orderedTeams])
  const [split, setSplit] = useState<DuelSplit | undefined>()
  const [options, setOptions] = useState<DuelScheduleOption[]>([]), [selectedId, setSelectedId] = useState<string>()
  const [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const feedbackRef = useRef<HTMLDivElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const [hash, setHash] = useState(season.duel_draft_plan_hash ?? null)
  const requestId = useRef(0), activeKey = useRef(''), seenSplits = useRef<string[]>([]), seenOptions = useRef(new Map<string, string[]>())
  const context = useQuery({ queryKey: ['flexible-duel-context', season.id, [...rosterIds].sort().join(':')], queryFn: () => fetchFlexibleDuelContext(league.id, season.id), enabled: editable && !hasFixtures && [8, 10, 12, 14].includes(rosterIds.length), staleTime: 0 })
  const actualCount = context.data?.rosterIds.length ?? rosterIds.length, size = actualCount / 2, validSize = [8, 10, 12, 14].includes(actualCount)
  let invalidLimits = false
  if (validSize) { try { validateDuelSettings(size, settings) } catch { invalidLimits = true } }
  const inputKey = context.data ? JSON.stringify([FLEXIBLE_DUEL_VERSION, context.data.key, settings]) : ''
  const savedMatchesInput = saved && saved.inputKey === JSON.stringify([FLEXIBLE_DUEL_VERSION, context.data?.key, saved.settings])
    && saved.settings.maxPartnerMeetings === settings.maxPartnerMeetings && saved.settings.maxOpponentMeetings === settings.maxOpponentMeetings
    && (saved.settings.maxMatchProbability ?? .65) === settings.maxMatchProbability && (saved.settings.maxRatingDifference ?? null) === settings.maxRatingDifference
  const input: DuelSearchInput | undefined = context.data ? { pool: context.data.pool, settings, inputKey, partnerHistory: context.data.partnerHistory.map(s => [...s]) } : undefined
  const selected = options.find(o => o.id === selectedId)
  const stop = () => { abort.current?.abort(); abort.current = null; requestId.current++; setBusy(false) }
  useEffect(() => () => { abort.current?.abort() }, [])
  useEffect(() => {
    if (!inputKey || activeKey.current === inputKey) return
    stop(); feasibility.current = createDuelFeasibilityState(); setSquadProgress(undefined); activeKey.current = inputKey; seenSplits.current = []; seenOptions.current.clear(); setOptions([]); setSplit(undefined); setSelectedId(undefined); setNotice(''); setError(''); setUnavailable(false)
    if (savedMatchesInput && saved.version === FLEXIBLE_DUEL_VERSION && isCurrentDuelPlan(saved) && hasUniqueDuelMatchups(saved.option.games) && isDuelRatingDifferenceAllowed(context.data?.pool ?? [], saved.option.games, settings.maxRatingDifference)) {
      feasibility.current.known = { options: [saved.option], status: 'FEASIBLE', split: { id: saved.splitId, squads: saved.squads, bestWorst: saved.option.metrics.worstFavorite } }
      seenSplits.current = [saved.splitId]
      setSplit({ id: saved.splitId, squads: saved.squads, bestWorst: saved.option.metrics.worstFavorite }); setOptions([saved.option]); setSelectedId(saved.option.id); seenOptions.current.set(saved.splitId, [saved.option.id])
    }
  // Snapshot changes invalidate results; background fetches of identical data do not.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey])
  useEffect(() => { if (!busy) return; const started = Date.now(); setElapsed(0); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer) }, [busy])
  async function fastSearch(chosen?: DuelSplit, refresh = false) {
    if (!input || !context.data) return
    stop(); const controller = new AbortController(); abort.current = controller
    const id = ++requestId.current
    persist.reset(); setBusy(true); setUnavailable(true); setError(''); setNotice(''); setFastProfile(chosen ? 'balance' : 'squads')
    try {
      const fresh = await fetchFlexibleDuelContext(league.id, season.id)
      if (id !== requestId.current) return
      if (fresh.key !== context.data.key) { void context.refetch(); throw new Error('DUEL_STALE_DRAFT') }
      const requestContext = { leagueId: league.id, seasonId: season.id, revision: fresh.revision, fingerprint: fresh.fingerprint }
      const onProfile = (profile: string) => { if (id === requestId.current) setFastProfile(profile) }
      const run = (excluded: string[]) => requestFastDuel(input, chosen, requestContext, excluded, controller.signal, onProfile)
      let result = chosen ? await run(refresh ? seenOptions.current.get(chosen.id) ?? [] : [])
        : await findFeasibleDuelSquads(input, requestContext, seenSplits.current, feasibility.current, controller.signal, onProfile,
          (checked, total) => { if (id === requestId.current) { setSquadProgress({ checked, total }); setFastProfile('squads') } })
      let restarted = false
      if (chosen && !result.options.length && result.status === 'INFEASIBLE' && refresh) {
        restarted = true
        result = await run(options.map(o => o.id))
        if (!result.options.length && result.status === 'INFEASIBLE') result = await run([])
      }
      if (id !== requestId.current) return
      setOptions(result.options); setSelectedId(result.options[0]?.id); setBusy(false); setUnavailable(!result.options.length)
      const verified = result.options.length ? result.split ?? chosen : undefined
      setSplit(verified ?? chosen)
      if (verified) {
        const previous = restarted ? [] : seenOptions.current.get(verified.id) ?? []
        seenOptions.current.set(verified.id, [...new Set([...previous, ...result.options.map(o => o.id)])])
        seenSplits.current = [...new Set([...seenSplits.current, verified.id])].slice(-1716)
      }
      setNotice(!result.options.length ? result.status === 'INFEASIBLE' ? chosen ? 'fastInfeasible' : 'noValid' : chosen ? 'fastLimited' : 'rosterLimited'
        : !chosen ? result.reused ? 'conditionsMetReused' : 'conditionsMet' : restarted ? 'restarted' : result.options.length < 2 ? 'fewer' : '')
    } catch (error) {
      if (id !== requestId.current || controller.signal.aborted) return
      const code = error instanceof Error ? error.message : 'SOLVER_FAILED'
      setError(t('flexibleDuel.fastErrors.' + code, { defaultValue: t('flexibleDuel.fastErrors.SOLVER_FAILED') })); setBusy(false); setUnavailable(true)
      if (code === 'DUEL_STALE_DRAFT') void context.refetch()
    }
  }
  const persist = useMutation({
    mutationFn: async (generate: boolean) => {
      if (!input || !context.data || !split || !selected || busy || unavailable || context.isFetching || context.isError) throw new Error(t('flexibleDuel.selectFirst'))
      const fresh = await fetchFlexibleDuelContext(league.id, season.id)
      if (fresh.key !== context.data.key) { setUnavailable(true); void context.refetch(); throw new Error(t('flexibleDuel.stale')) }
      const plan: FlexibleDuelPlan = { version: FLEXIBLE_DUEL_VERSION, inputKey, splitId: split.id, settings, squads: split.squads, option: selected, engine: 'cp-sat' }
      return saveFlexibleDuelPlan(season.id, plan, names, fresh.revision, fresh.fingerprint, hash, generate, colors)
    },
    onSuccess: async result => { setHash(result.hash); setNotice(result.count ? 'generated' : 'saved'); await Promise.all(['teams', 'teams-with-players', 'matches', 'seasons', 'assigned-pool-players'].map(key => client.invalidateQueries({ queryKey: [key] }))) },
    onError: () => { void context.refetch(); void client.invalidateQueries({ queryKey: ['seasons'] }) },
  })
  useEffect(() => { setHash(season.duel_draft_plan_hash ?? null) }, [season.duel_draft_plan_hash])
  const pool = new Map((context.data?.pool ?? []).map(p => [p.id, p])), playerName = (id: string) => pool.get(id)?.name ?? teams.flatMap(t => t.players).find(p => p.pool_player_id === id)?.name ?? id
  const disabled = invalidLimits || busy || unavailable || context.isFetching || context.isError || !selected || persist.isPending || names.some(n => !n.trim())
  const noScheduleNotice = ['noValid', 'fastInfeasible', 'fastLimited', 'rosterLimited'].includes(notice) ? notice : ''
  const feedbackError = persist.error?.message ?? error
  useEffect(() => {
    if (!noScheduleNotice && !feedbackError) return
    // A finished search can leave a mobile user looking at the squad lists.
    // Focus and reveal the explanation instead of leaving an empty options area.
    feedbackRef.current?.focus({ preventScroll: true })
    feedbackRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [noScheduleNotice, feedbackError])
  return <section className="mb-8 space-y-4 rounded-xl border border-green-200 bg-white p-5">
    <h2 className="text-lg font-bold text-green-950">{t('leagueDuel.title')}</h2>
    <p className="text-sm text-gray-600">{t('flexibleDuel.rules')}</p>
    {hasFixtures ? <>
      <p>{t('leagueDuel.frozen')}</p>
      <div className="grid gap-4 sm:grid-cols-2">{teams.map(team => <div key={team.id}><h3 className="font-bold" style={{ color: team.color }}>{team.name}</h3>{editable ? <LeagueDuelTeamNameForm team={team} disabled={persist.isPending} /> : null}<ul>{team.players.map(p => <li key={p.id}>{p.name}</li>)}</ul></div>)}</div>
      {saved ? <><p>{t('flexibleDuel.savedLimits', { partner: saved.settings.maxPartnerMeetings ?? t('flexibleDuel.noLimit'), opponent: saved.settings.maxOpponentMeetings ?? t('flexibleDuel.noLimit'), gap: saved.settings.maxRatingDifference ?? t('flexibleDuel.noLimit') })}</p>{saved.settings.maxMatchProbability !== undefined ? <p>{t('flexibleDuel.matchProbabilityHelp', { max: Math.round(saved.settings.maxMatchProbability * 10000) / 100, min: Math.round((1 - saved.settings.maxMatchProbability) * 10000) / 100 })}</p> : null}</> : null}
      {editable && fixtures?.length ? <SeasonMatchDeletion season={season} fixtures={fixtures} busy={persist.isPending} onCleared={() => { stop(); setOptions([]); setHash(null) }} /> : null}
      <Link to={leaguePath('/matches')} className="text-green-800 underline">{t('leagueDuel.viewGames')}</Link>
    </> : editable ? <>
      <p className="text-xs text-gray-600">{t('flexibleDuel.fastHelp')}</p>
      {!validSize ? <p>{t('leagueDuel.rosterSize', { count: rosterIds.length })}</p> : <>
        <div className="grid gap-4 sm:grid-cols-2">{(['maxPartnerMeetings', 'maxOpponentMeetings'] as const).map(field => <label key={field} className="text-sm font-semibold">{t(`flexibleDuel.${field}`)}<select aria-label={t(`flexibleDuel.${field}`)} className="mt-1 block min-h-11 w-full rounded-lg border px-3" value={settings[field] ?? 'none'} disabled={persist.isPending} onChange={e => setSettings(s => ({ ...s, [field]: e.target.value === 'none' ? null : Number(e.target.value) }))}>
          {settings[field] !== null && settings[field]! > size - 1 ? <option value={settings[field]!} disabled>{settings[field]}</option> : null}{Array.from({ length: size - 1 }, (_, i) => i + 1).map(n => <option key={n} value={n} disabled={field === 'maxOpponentMeetings' && n * size < 2 * (size - 1)}>{n}</option>)}<option value="none">{t('flexibleDuel.noLimit')}</option>
        </select></label>)}</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm font-semibold">{t('flexibleDuel.maxRatingDifference')}
            <select aria-label={t('flexibleDuel.maxRatingDifference')} className="mt-1 block min-h-11 rounded-lg border px-3" value={settings.maxRatingDifference == null ? 'none' : 'limit'} disabled={persist.isPending} onChange={e => setSettings(s => ({ ...s, maxRatingDifference: e.target.value === 'none' ? null : 400 }))}>
              <option value="none">{t('flexibleDuel.noLimit')}</option><option value="limit">{t('flexibleDuel.setLimit')}</option>
            </select>
          </label>
          {settings.maxRatingDifference != null ? <label className="block text-sm font-semibold">{t('flexibleDuel.ratingDifferencePoints')}
            <input type="number" min={0} step={1} aria-label={t('flexibleDuel.ratingDifferencePoints')} className="mt-1 block min-h-11 w-40 rounded-lg border px-3" value={Number.isFinite(settings.maxRatingDifference) ? settings.maxRatingDifference : ''} disabled={persist.isPending} onChange={e => setSettings(s => ({ ...s, maxRatingDifference: e.target.value === '' ? NaN : Number(e.target.value) }))} />
          </label> : null}
        </div>
        <p className="text-xs text-gray-600">{t('flexibleDuel.ratingDifferenceHelp')}</p>
        <label className="block text-sm font-semibold">{t('flexibleDuel.maxMatchProbability')}
          <input type="number" min={50} max={100} step={1} aria-label={t('flexibleDuel.maxMatchProbability')} className="mt-1 block min-h-11 w-full rounded-lg border px-3 sm:w-40" value={Number.isFinite(settings.maxMatchProbability) ? Math.round(settings.maxMatchProbability! * 10000) / 100 : ''} disabled={persist.isPending} onChange={e => setSettings(s => ({ ...s, maxMatchProbability: e.target.value === '' ? NaN : Number(e.target.value) / 100 }))} />
        </label>
        <p className="text-xs text-gray-600">{t('flexibleDuel.matchProbabilityHelp', { max: Number.isFinite(settings.maxMatchProbability) ? Math.round(settings.maxMatchProbability! * 10000) / 100 : '—', min: Number.isFinite(settings.maxMatchProbability) ? Math.round((1 - settings.maxMatchProbability!) * 10000) / 100 : '—' })}</p>
        <p className="text-xs text-gray-600">{t('flexibleDuel.limitHelp')}</p>
        {invalidLimits ? <p role="alert" className="text-sm text-red-800">{t('flexibleDuel.invalidLimits')}</p> : null}
        <p className="text-xs">{t('flexibleDuel.participation', { games: size - 1 })} {t('flexibleDuel.seasonBalanceLimit')}</p>
        <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={invalidLimits || !context.data || context.isFetching || busy || persist.isPending} onClick={() => void fastSearch()}>{t(!split && feasibility.current.attempt > 0 && notice === 'rosterLimited' ? 'flexibleDuel.continueConditions' : split ? 'flexibleDuel.shuffle' : 'flexibleDuel.search')}</button><button type="button" className={button} disabled={!split || invalidLimits || busy || persist.isPending} onClick={() => void fastSearch(split!, true)}>{t('flexibleDuel.refreshSchedules')}</button>{busy ? <button type="button" className={button} onClick={() => { stop(); setUnavailable(true); setNotice('cancelled') }}>{t('flexibleDuel.cancel')}</button> : null}</div>
        {busy ? <div role="status"><p>{fastProfile === 'squads' ? t('flexibleDuel.checkingConditions', { checked: squadProgress?.checked ?? 0, total: squadProgress?.total ?? '…', seconds: elapsed }) : t('flexibleDuel.fastProgress', { profile: t(`flexibleDuel.kind.${fastProfile}`), seconds: elapsed })}</p><p className="text-xs">{t(fastProfile === 'variety' ? 'flexibleDuel.varietySearchHelp' : 'flexibleDuel.fastHelp')}</p></div> : null}
        {context.isFetching ? <p role="status">{t('common.loading')}</p> : null}
        {context.error ? <ErrorState message={context.error.message} /> : null}
        {noScheduleNotice || feedbackError ? <div ref={feedbackRef} role="alert" tabIndex={-1} className={`scroll-mt-6 rounded-xl border p-4 text-sm focus:outline-none focus:ring-2 ${feedbackError ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-500' : 'border-amber-400 bg-amber-50 text-amber-950 focus:ring-amber-500'}`}>
          <p className="font-bold">{t(feedbackError ? 'error.title' : ['fastLimited', 'rosterLimited'].includes(noScheduleNotice) ? 'flexibleDuel.searchTimeLimitTitle' : noScheduleNotice === 'noValid' ? 'flexibleDuel.conditionsImpossibleTitle' : 'flexibleDuel.noScheduleTitle')}</p>
          <p className="mt-1">{feedbackError || t(`flexibleDuel.notice.${noScheduleNotice}`)}</p>
          {noScheduleNotice === 'rosterLimited' && squadProgress ? <p className="mt-2">{t('flexibleDuel.conditionCoverage', squadProgress)}</p> : null}
          {!feedbackError ? <p className="mt-2 font-medium">{t('flexibleDuel.searchLimits', { partner: settings.maxPartnerMeetings ?? t('flexibleDuel.noLimit'), opponent: settings.maxOpponentMeetings ?? t('flexibleDuel.noLimit'), gap: settings.maxRatingDifference ?? t('flexibleDuel.noLimit'), max: Math.round((settings.maxMatchProbability ?? .65) * 10000) / 100, min: Math.round((1 - (settings.maxMatchProbability ?? .65)) * 10000) / 100 })}</p> : null}
        </div> : null}
        {notice && !noScheduleNotice ? <p role="status" className="text-sm text-green-900">{t(`flexibleDuel.notice.${notice}`, { count: options.length })}</p> : null}
        {split ? <div className="grid gap-4 sm:grid-cols-2">{split.squads.map((s, side) => <div key={side}><label className="text-sm font-bold">{t(side ? 'leagueDuel.nameB' : 'leagueDuel.nameA')}<input className="mt-1 block min-h-11 w-full rounded-lg border px-3" value={names[side]} maxLength={120} disabled={persist.isPending} onChange={e => { named.current = true; setNames(ns => side === 0 ? [e.target.value, ns[1]] : [ns[0], e.target.value]) }} /></label><div className="mt-3"><TeamColorField value={colors[side]!} disabled={persist.isPending} onChange={color => { setColors(side === 0 ? [color, colors[1]] : [colors[0], color]); persist.reset() }} /></div><ul className="mt-2 text-sm">{s.map(id => <li key={id}>{playerName(id)} <span className="text-gray-500">{pool.get(id) ? Math.round(pool.get(id)!.rating) : ''}</span></li>)}</ul></div>)}</div> : null}
        <div className="grid gap-3 lg:grid-cols-2">{options.map(option => {
          const m = option.metrics
          const hardest = [...m.players].sort((a, b) => b.below40 - a.below40 || b.disadvantage - a.disadvantage)[0]!
          const partnerCounts = m.players.map(player => player.partners)
          const minPartners = Math.min(...partnerCounts), maxPartners = Math.max(...partnerCounts)
          return <label key={option.id} className={`rounded-lg border p-4 ${selected?.id === option.id ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}>
            <span className="flex gap-2 font-bold"><input type="radio" name={`duel-${season.id}`} checked={selectedId === option.id} disabled={busy || persist.isPending || unavailable} onChange={() => { setSelectedId(option.id); persist.reset() }} />{t(`flexibleDuel.kind.${option.kind}`)}</span>
            <p className="mt-2 text-xs text-gray-600">{t(`flexibleDuel.fastKindHelp.${option.kind}`)}</p>
            <p className="mt-2">{t('flexibleDuel.matchMetrics', { worst: (100 * m.worstFavorite).toFixed(1), within: m.within60, total: option.games.length, average: (100 * m.averageFavorite).toFixed(1) })}</p>
            <div className="mt-2 text-sm">
              <p>{t('flexibleDuel.opponentCoverage', { covered: m.coveredOpponents, possible: size * size })}</p>
              <p>{t('flexibleDuel.partnerCoverage', { covered: m.usedPartners, possible: size * (size - 1) })}</p>
              <p>{minPartners === maxPartners
                ? t('flexibleDuel.partnersPerPlayer', { partners: minPartners })
                : t('flexibleDuel.partnersPerPlayerRange', { min: minPartners, max: maxPartners })}</p>
            </div>
            <p className="mt-2 text-sm">{t('flexibleDuel.hardest', { name: playerName(hardest.id), games: hardest.below40 })}</p>
            <p className="mt-2 text-xs">{t('flexibleDuel.actualCaps', { partner: m.maxPartnerMeetings, opponent: m.maxOpponentMeetings })}</p>
            <div className="mt-2 text-xs">{option.solver ? t(option.solver.status === 'OPTIMAL' ? 'flexibleDuel.solverOptimal' : 'flexibleDuel.solverFeasible') : null}</div>
            <div className="mt-3"><SeasonForecastSummary forecast={m.forecast} names={names} /></div>
          </label>
        })}</div>
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
    {(hasFixtures || !editable || !validSize) && feedbackError ? <ErrorState message={feedbackError} /> : null}
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
