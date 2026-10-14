import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { useBetData } from '../hooks/useBets'
import { totalPrizes } from '../lib/myProfile'
import { formatPicklePoints, formatSignedPicklePoints } from '../lib/picklePoints'
import { ErrorState, LoadingState } from './Layout'
import { ProfileStatCard } from './ProfileStatCard'

export function MyProfilePoints() {
  const { t, i18n } = useTranslation()
  const { league, leaguePath } = useLeague()
  const { wallet, history } = useBetData({ includeBets: false })
  return <div className="space-y-5">
    <p className="text-sm text-gray-600">{t('me.pointsScope', { league: league.name })}</p>
    {wallet.isLoading ? <LoadingState /> : wallet.error ? <><ErrorState message={t('me.walletError')} /><button type="button" className="mt-2 min-h-11 text-sm font-bold text-green-700 underline" onClick={() => void wallet.refetch()}>{t('me.retry')}</button></> : wallet.data ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(['balance', 'available', 'reserved', 'owed'] as const).map(key => <ProfileStatCard key={key} label={t(`bets.${key}`)} value={formatPicklePoints(wallet.data[key])} />)}</div> : null}
    <div className="flex flex-wrap gap-3">{(['mine', 'history'] as const).map(tab => <Link key={tab} to={leaguePath(`/bets?tab=${tab}`)} className="inline-flex min-h-11 items-center rounded-lg border border-green-200 bg-white px-4 text-sm font-bold text-green-800 hover:bg-green-50">{t(tab === 'mine' ? 'me.myBets' : 'me.pointHistory')}</Link>)}</div>
    {history.isLoading ? <LoadingState /> : history.error ? <><ErrorState message={t('me.historyError')} /><button type="button" className="min-h-11 text-sm font-bold text-green-700 underline" onClick={() => void history.refetch()}>{t('me.retry')}</button></> : history.data ? <>
      <div className="max-w-sm"><ProfileStatCard label={t('me.prizesEarned')} value={formatPicklePoints(totalPrizes(history.data))} /></div>
      <section className="rounded-xl border border-green-200 bg-white p-5"><h2 className="text-lg font-bold text-green-950">{t('me.recentTransactions')}</h2>
        {!history.data.length ? <p className="mt-3 text-sm text-gray-600">{t('me.noTransactions')}</p> : <ul className="mt-3 divide-y divide-green-100">{[...history.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 5).map(item => <li key={item.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><div><p className="font-semibold text-green-950">{t(`bets.kinds.${item.kind}`)} · {item.seasonName}</p><p className="mt-1 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString(i18n.language)}</p></div><strong className="text-green-900">{formatSignedPicklePoints(item.amount)}</strong></li>)}</ul>}
      </section>
    </> : null}
  </div>
}
