import { useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useLeague } from '../context/LeagueContext'
import { useSeason } from '../context/SeasonContext'
import { useBetData } from '../hooks/useBets'
import { useMatches } from '../hooks/useMatches'
import { usePlayerPool } from '../hooks/usePlayerPool'
import { acceptBet, betErrorMessage, cancelBet, type PickleBet } from '../lib/betsApi'
import { formatPicklePoints, formatSignedPicklePoints } from '../lib/picklePoints'
import { hasBetFunds, matchBettingStatus } from '../lib/matchBetting'
import { useConfirm } from '../lib/confirmation'
import { ErrorState, PageHeader } from '../components/Layout'
import { BetSettlementReview } from '../components/BetSettlementReview'
import { BetOfferCard } from '../components/BetOfferCard'
import { BetAcceptanceDetails } from '../components/BetSlip'

const buttonClass = 'min-h-11 rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50'
export function BetsPage() {
  const { t, i18n } = useTranslation()
  const { user, isAdmin } = useAuth()
  const { league, leaguePath } = useLeague()
  const { selectedSeason } = useSeason()
  const { account, wallet, bets, history } = useBetData()
  const matches = useMatches()
  const pool = usePlayerPool()
  const client = useQueryClient()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'mine' ? 'mine' : params.get('tab') === 'history' ? 'history' : 'open'
  const acceptRequests = useRef(new Map<string,string>())
  const playerId = account.data?.playerId
  const activeMember = pool.data?.some(p => p.id === playerId && p.status === 'active')
  const canBet = !!playerId && activeMember && league.status === 'active' && selectedSeason?.status === 'active' && !wallet.isError
  const matchStatuses = new Map((matches.data ?? []).map(match => [match.id, matchBettingStatus(match, playerId)]))
  const refresh = async () => { await Promise.all(['bets','pickle-points','matches'].map(key=>client.invalidateQueries({queryKey:[key]}))) }
  const action = useMutation({ mutationFn: async ({bet,cancel}:{bet:PickleBet;cancel:boolean}) => {
    if (cancel) { await cancelBet(bet.id); return }
    if (!canBet || bet.creatorId === playerId || bet.state !== 'open' || matchStatuses.get(bet.matchId) !== 'open') throw new Error(t('matchBets.closed'))
    if (!hasBetFunds(wallet.data?.available, bet.acceptorStake)) throw new Error(t('matchBets.insufficient'))
    let id=acceptRequests.current.get(bet.id)
    if(!id){id=crypto.randomUUID();acceptRequests.current.set(bet.id,id)}
    await acceptBet(bet.id,id)
  }, onSuccess: refresh })
  async function reviewOffer(bet: PickleBet) {
    if (action.isPending) return
    if (await confirm(t('betSlip.reviewTerms'), { title: t('betSlip.reviewTitle'), confirmLabel: t('betSlip.acceptOffer'), details: <BetAcceptanceDetails bet={bet} /> })) {
      action.mutate({ bet, cancel: false })
    }
  }
  const pendingStates = ['open','accepted','review']
  const shown = (bets.data ?? []).filter(b => tab==='open' ? b.state==='open' && b.seasonId===selectedSeason?.id
    : tab==='mine' ? (b.creatorId===playerId || b.acceptorId===playerId) && pendingStates.includes(b.state)
    : (b.creatorId===playerId || b.acceptorId===playerId) && !pendingStates.includes(b.state))
  if (!user) return <><PageHeader title={t('bets.title')} subtitle={t('bets.description')} /><p className="mb-3">{t('bets.loginHelp')}</p><div className="flex flex-wrap gap-3"><Link className={buttonClass+' inline-flex items-center'} to={leaguePath('/login')}>{t('auth.signIn')}</Link><Link className="inline-flex min-h-11 items-center rounded-xl border border-green-300 px-4 py-2 font-bold text-green-800 hover:bg-green-50" to={leaguePath('/signup')}>{t('auth.signUp')}</Link></div></>
  return <div>
    <PageHeader title={t('bets.title')} subtitle={t('bets.description')} />
    {account.isLoading ? <p>{t('common.loading')}</p> : account.error ? <ErrorState message={betErrorMessage(account.error, t)} /> : !account.data ? <p className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t('bets.unlinked')}</p> : <p className="mb-3 text-sm font-semibold text-green-900">{account.data.name}</p>}
    {wallet.isLoading && playerId ? <p>{t('common.loading')}</p> : wallet.error ? <ErrorState message={betErrorMessage(wallet.error, t)} /> : wallet.data ? <>
      <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{(['balance','reserved','available','owed'] as const).map(key=><div key={key} className="rounded-xl border border-green-200 bg-white p-3"><dt className="text-xs text-gray-600">{t(`bets.${key}`)}</dt><dd className="mt-1 break-words font-bold text-green-950">{formatPicklePoints(wallet.data[key])}</dd></div>)}</dl>
      <p className="mb-4 text-xs text-gray-600">{t('bets.walletHelp')}</p>
    </> : null}
    {playerId && pool.isSuccess && !activeMember ? <p className="mb-4 text-sm text-amber-900">{t('bets.inactive')}</p> : null}
    {canBet ? <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-white p-4">
      <div><h2 className="font-semibold text-green-950">{t('matchBets.startTitle')}</h2><p className="mt-1 text-sm text-gray-600">{t('matchBets.startHelp')}</p></div>
      <Link to={leaguePath('/matches?betting=open')} className={buttonClass+' inline-flex items-center justify-center'}>{t('bets.create')}</Link>
    </section> : null}
    <nav className="mb-4 flex flex-wrap gap-2" aria-label={t('bets.views')}>{(['open','mine','history'] as const).map(view=><button key={view} type="button" aria-pressed={tab===view} onClick={()=>setParams({tab:view})} className={`min-h-11 rounded-lg px-4 text-sm font-bold ${tab===view?'bg-green-700 text-white':'border border-green-200 bg-white text-green-800'}`}>{t(`bets.${view}`)}</button>)}</nav>
    {bets.isLoading ? <p>{t('common.loading')}</p> : bets.error ? <ErrorState message={betErrorMessage(bets.error, t)}/> : <div className="grid items-start gap-4 md:grid-cols-2">{!shown.length ? <p className="text-sm text-gray-500">{t('bets.empty')}</p> : shown.map(b => <BetOfferCard
      key={b.id} bet={b} playerId={playerId} wallet={wallet.data} pending={action.isPending}
      canReview={canBet && matchStatuses.get(b.matchId) === 'open'}
      context={b.seasonId === selectedSeason?.id ? selectedSeason.name : undefined}
      unavailableReason={t(!playerId ? 'bets.unlinked' : !activeMember ? 'bets.inactive' : matchStatuses.get(b.matchId) === 'participant' ? 'matchBets.participant' : 'matchBets.closed')}
      onReview={() => { void reviewOffer(b) }}
      onCancel={() => action.mutate({ bet: b, cancel: true })}
    />)}</div>}
    {action.error ? <ErrorState message={betErrorMessage(action.error, t)}/> : null}
    {tab==='history' && playerId ? <section className="mt-6"><h2 className="mb-3 font-bold text-green-950">{t('bets.transactions')}</h2>{history.isLoading?<p>{t('common.loading')}</p>:history.error?<ErrorState message={betErrorMessage(history.error, t)}/>:<ul className="space-y-2">{history.data?.map(item=><li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-green-100 bg-white p-3 text-sm"><div><p>{t(`bets.kinds.${item.kind}`)} · {item.seasonName}</p><p className="mt-1 text-xs text-gray-500">{new Date(item.createdAt).toLocaleString(i18n.language)}{item.revision ? ` · ${t('bets.revision',{number:item.revision})}`:''}{item.reason && item.reason!=='confirmed'?` · ${item.reason}`:''}</p></div><strong className="text-green-900">{formatSignedPicklePoints(item.amount)}</strong></li>)}</ul>}</section> : null}
    {isAdmin && selectedSeason?.status==='active' ? <section className="mt-6"><h2 className="mb-3 text-lg font-bold text-green-950">{t('bets.adminReview')}</h2><p className="mb-3 text-sm text-gray-600">{t('bets.reviewHelp')}</p><div className="space-y-3">{(matches.data??[]).filter(m=>m.status!=='scheduled' && bets.data?.some(b=>b.matchId===m.id && ['review','settled','refunded'].includes(b.state))).map(m=><BetSettlementReview key={m.id} match={m}/>)}</div></section> : null}
  </div>
}
