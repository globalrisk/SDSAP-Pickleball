import { useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { useSeason } from '../context/SeasonContext'
import { useMyPlayerAccount } from '../hooks/useBets'
import { usePlayerPool } from '../hooks/usePlayerPool'
import { usePlayerProfile } from '../hooks/usePlayerProfile'
import { useMatches } from '../hooks/useMatches'
import { useTournamentRealtime } from '../hooks/useTournamentRealtime'
import { PROFILE_TABS, profileTab, selectedSeasonStats, type ProfileTab } from '../lib/myProfile'
import { roundRating } from '../lib/ratings'
import { MyAccountSettings } from '../components/MyAccountSettings'
import { MyProfileMatches } from '../components/MyProfileMatches'
import { MyProfilePoints } from '../components/MyProfilePoints'
import { ProfileStatCard } from '../components/ProfileStatCard'
import { ProfileFunStats } from '../components/ProfileFunStats'
import { ProfileRivalries } from '../components/ProfileRivalries'
import { PlayerTitleBadge } from '../components/PlayerTitleBadge'
import { RatingHistoryChart } from '../components/RatingHistoryChart'
import { ErrorState, LoadingState, PageHeader } from '../components/Layout'
import type { PlayerProfile, PoolPlayer } from '../types'

function Retry({ onRetry, message }: { onRetry: () => void; message: string }) {
  const { t } = useTranslation()
  return <div><ErrorState message={message} /><button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-lg px-3 text-sm font-bold text-green-700 underline focus-visible:ring-2 focus-visible:ring-green-600">{t('me.retry')}</button></div>
}

export function MyProfilePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { league } = useLeague()
  const account = useMyPlayerAccount()
  const pool = usePlayerPool()
  const [params, setParams] = useSearchParams()
  const tab = profileTab(params.get('tab'))
  const member = pool.data?.find(player => player.id === account.data?.playerId)
  const selectTab = (next: ProfileTab) => setParams(previous => { const nextParams = new URLSearchParams(previous); nextParams.set('tab', next); return nextParams })
  let content: ReactNode
  if (tab === 'settings') {
    content = <>
      {account.isError ? <Retry message={t('me.accountError')} onRetry={() => void account.refetch()} /> : account.isLoading ? <p role="status" className="mb-3 text-sm text-gray-600">{t('common.loading')}</p> : null}
      <MyAccountSettings key={user?.id} playerName={account.data?.name} />
    </>
  } else if (account.isLoading) content = <LoadingState />
  else if (account.isError) content = <Retry message={t('me.accountError')} onRetry={() => void account.refetch()} />
  else if (!account.data) content = <IdentityNotice message={t('me.unlinkedHelp')} />
  else if (pool.isLoading) content = <LoadingState />
  else if (pool.isError) content = <Retry message={t('me.membershipError')} onRetry={() => void pool.refetch()} />
  else if (!member) content = <IdentityNotice message={t('me.nonMember', { league: league.name })} />
  else content = <MemberProfile key={`${league.id}:${user?.id}:${member.id}`} member={member} players={pool.data ?? []} tab={tab} />
  return <div>
    <PageHeader title={account.data?.name ?? t('me.title')} subtitle={league.name} />
    {account.data ? <p className="-mt-3 mb-5 text-xs font-semibold text-green-700">{t('me.linked')}</p> : null}
    <nav aria-label={t('me.menu')} className="mb-5 grid grid-cols-5 gap-1 rounded-xl border border-green-200 bg-white p-1">
      {PROFILE_TABS.map(item => <button key={item} type="button" aria-current={tab === item ? 'page' : undefined} onClick={() => selectTab(item)} className={`min-h-11 min-w-0 break-words rounded-lg px-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-1 sm:px-3 sm:text-sm ${tab === item ? 'bg-green-700 text-white' : 'text-green-800 hover:bg-green-50'}`}>{t(`me.tabs.${item}`)}</button>)}
    </nav>
    {content}
  </div>
}

function IdentityNotice({ message }: { message: string }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900">{message}</p>
}

function MemberProfile({ member, players, tab }: { member: PoolPlayer; players: PoolPlayer[]; tab: ProfileTab }) {
  const { t } = useTranslation()
  const { selectedSeason, isLoading: seasonsLoading, isError: seasonsError } = useSeason()
  const profile = usePlayerProfile(member.id)
  const matches = useMatches()
  useTournamentRealtime(selectedSeason?.id)
  const [params, setParams] = useSearchParams()
  const seasonal = params.get('scope') === 'season'
  const names = useMemo(() => new Map(players.map(player => [player.id, player.name])), [players])
  const seasonStats = useMemo(() => profile.data && selectedSeason && matches.data
    ? selectedSeasonStats(profile.data, selectedSeason.id, matches.data, names, selectedSeason.name) : null,
  [profile.data, selectedSeason, matches.data, names])
  if (tab === 'points') return <MyProfilePoints />
  if (profile.isLoading) return <LoadingState />
  if (profile.isError) return <Retry message={t('me.statsError')} onRetry={() => void profile.refetch()} />
  if (!profile.data) return null
  const data = profile.data
  const matchesView = (preview = false) => seasonsLoading || matches.isLoading ? <LoadingState /> : seasonsError ? <ErrorState message={t('me.seasonError')} /> : matches.isError ? <Retry message={t('me.matchesError')} onRetry={() => void matches.refetch()} /> : <MyProfileMatches profile={data} matches={matches.data ?? []} season={selectedSeason} names={names} preview={preview} />
  if (tab === 'matches') return matchesView()
  const stats = seasonal ? seasonStats : data
  return <div className="space-y-5">
    {member.status === 'inactive' ? <IdentityNotice message={t('me.inactive')} /> : null}
    <section className="rounded-xl border border-green-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold text-green-950">{t('me.currentStanding')}</h2>{data.title ? <PlayerTitleBadge title={data.title} showWhy size="md" /> : null}</div>
      <div className="grid grid-cols-2 gap-3"><ProfileStatCard label={t('me.currentRating')} value={String(roundRating(data.rating))} /><ProfileStatCard label={t('me.currentRank')} value={data.rank == null ? t(data.provisional ? 'me.provisional' : 'me.unranked') : `#${data.rank}`} /></div>
    </section>
    {tab === 'stats' ? <div className="flex flex-wrap items-center justify-between gap-3"><div role="group" aria-label={t('me.statsPeriod')} className="flex gap-2">{['all', 'season'].map(scope => <button key={scope} type="button" aria-pressed={seasonal === (scope === 'season')} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('scope', scope); return next })} className={`min-h-11 rounded-lg px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${seasonal === (scope === 'season') ? 'bg-green-700 text-white' : 'border border-green-200 bg-white text-green-800'}`}>{t(scope === 'all' ? 'me.allTime' : 'me.selectedSeason')}</button>)}</div><p className="text-sm text-gray-600">{seasonal ? selectedSeason?.name : t('me.allTimeLeague')}</p></div> : <p className="text-sm font-semibold text-gray-600">{t('me.allTimeLeague')}</p>}
    {tab === 'stats' && seasonal && (!stats || matches.isError || seasonsError) ? matchesView() : <>
      <RecordStats stats={tab === 'overview' ? data : stats ?? data} seasonal={tab === 'stats' && seasonal} />
      {tab === 'stats' && stats ? <>
        {'forfeits' in stats ? <p className="text-xs text-gray-600">{t('me.forfeitsSeparate', { count: stats.forfeits })}</p> : null}
        <ProfileFunStats stats={stats.funStats} playerName={data.name} personal />
        <ProfileRivalries playerName={data.name} rivalries={stats.rivalries} />
        <section className="rounded-xl border border-green-200 bg-white p-5"><h2 className="mb-3 text-lg font-bold text-green-950">{t('profile.historyTitle')}</h2><RatingHistoryChart key={`${member.id}:${seasonal ? selectedSeason?.id : 'all'}`} points={stats.history} /></section>
      </> : null}
    </>}
    {tab === 'overview' ? matchesView(true) : null}
  </div>
}

function RecordStats({ stats, seasonal }: { stats: Pick<PlayerProfile, 'played' | 'wins' | 'losses' | 'winRate' | 'form' | 'funStats'> & { ratingDelta: number | null }; seasonal: boolean }) {
  const { t } = useTranslation()
  const delta = stats.ratingDelta == null ? null : roundRating(stats.ratingDelta)
  return <>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <ProfileStatCard label={t('me.matchesPlayed')} value={String(stats.played)} />
      <ProfileStatCard label={t('profile.record')} value={`${stats.wins}–${stats.losses}`} />
      <ProfileStatCard label={t('profile.winRate')} value={stats.played ? `${Math.round(stats.winRate * 100)}%` : '—'} />
      <ProfileStatCard label={t(seasonal ? 'me.seasonChange' : 'me.totalChange')} value={delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}`} accent={delta != null && delta > 0 ? 'up' : delta != null && delta < 0 ? 'down' : 'neutral'} />
    </div>
    {delta == null ? <p className="text-xs text-gray-600">{t('me.ratingUnavailable')}</p> : null}
    <section className="rounded-xl border border-green-200 bg-white p-5"><h2 className="mb-3 font-bold text-green-950">{t('profile.formTitle')}</h2>
      {!stats.form.length ? <p className="text-sm text-gray-600">{t('profile.noMatches')}</p> : <div className="flex flex-wrap items-center gap-2">{stats.form.map((result, index) => <span key={index} className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${result === 'W' ? 'bg-green-600' : 'bg-red-500'}`}>{result}</span>)}{stats.funStats.currentStreak ? <p className="ml-2 text-sm text-gray-600">{t(stats.funStats.currentStreak.result === 'W' ? 'profile.streakValueWin' : 'profile.streakValueLoss', { count: stats.funStats.currentStreak.count })}</p> : null}</div>}
    </section>
  </>
}
