import { useTranslation } from 'react-i18next'
import { addPoints, type PickleBet, type PickleWallet } from '../lib/betsApi'
import { hasBetFunds } from '../lib/matchBetting'
import { formatPicklePoints } from '../lib/picklePoints'
import { BetPairSummary, BetTerms } from './BetSlip'

export function BetOfferCard({ bet, playerId, wallet, canReview = false, pending = false, context, unavailableReason, onReview, onCancel }: {
  bet: PickleBet; playerId?: string; wallet?: PickleWallet; canReview?: boolean; pending?: boolean
  context?: string; unavailableReason?: string; onReview?: () => void; onCancel?: () => void
}) {
  const { t } = useTranslation()
  const ownOffer = bet.creatorId === playerId
  const personal = ownOffer || bet.acceptorId === playerId || (bet.state === 'open' && canReview)
  const creatorPair = bet.creatorSide === bet.homeTeamId ? bet.homeNames : bet.awayNames
  const opposingPair = bet.creatorSide === bet.homeTeamId ? bet.awayNames : bet.homeNames
  const stake = ownOffer ? bet.creatorStake : bet.acceptorStake
  const profit = ownOffer ? bet.acceptorStake : bet.creatorStake
  const otherName = ownOffer ? bet.acceptorName : bet.creatorName
  const funded = hasBetFunds(wallet?.available, stake)
  const shortfall = wallet && !funded
    ? addPoints(stake, wallet.available.startsWith('-') ? wallet.available.slice(1) : `-${wallet.available}`)
    : null
  const needsReview = bet.state === 'open' && !ownOffer && !!onReview
  return <article className="bet-offer-card min-w-0 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="font-semibold text-green-700">{t(`bets.states.${bet.state}`)}</p>
      {context ? <p className="min-w-0 break-words text-gray-500">{context}</p> : null}
    </header>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
      <p className="min-w-0 break-words text-gray-700">{t(ownOffer ? 'betSlip.yourOffer' : 'betSlip.offerBy', { name: bet.creatorName })}</p>
      {needsReview && wallet ? <p className="text-gray-500">{t('bets.available')} <span className="font-semibold text-gray-700 tabular-nums">{formatPicklePoints(wallet.available)}</span></p> : null}
    </div>
    <div className="bet-pair-grid mt-4">
      <BetPairSummary names={ownOffer ? creatorPair : opposingPair} label={t(personal ? 'betSlip.youBack' : 'betSlip.opposingPair')} highlighted={personal} />
      <p className="bet-pair-versus px-3 text-xs text-gray-400">{t('common.vs')}</p>
      <BetPairSummary names={ownOffer ? opposingPair : creatorPair} label={otherName ? t('betSlip.namedBacks', { name: otherName }) : t('betSlip.opponentBacks')} />
    </div>
    <BetTerms stake={stake} profit={profit} personal={personal} />
    {bet.closeReason ? <p className="mt-3 text-xs text-gray-500">{t(`bets.closeReasons.${bet.closeReason}`)}</p> : null}
    {needsReview ? <div className="mt-4">
      {!canReview && unavailableReason ? <p className="mb-3 text-xs text-gray-600">{unavailableReason}</p> : null}
      {canReview && shortfall ? <p className="mb-3 text-sm text-red-700">{t('betSlip.shortfall', { amount: formatPicklePoints(shortfall) })}</p> : null}
      {canReview && !wallet ? <p className="mb-3 text-xs text-gray-600">{t('betSlip.fundsUnavailable')}</p> : null}
      <button type="button" disabled={pending || !canReview || !funded} onClick={onReview} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500">
        {t(!canReview ? 'betSlip.unavailable' : wallet && !funded ? 'betSlip.insufficient' : 'betSlip.reviewOffer')}
        {canReview && funded ? <span aria-hidden="true">→</span> : null}
      </button>
    </div> : null}
    {bet.state === 'open' && ownOffer ? onCancel ? <button type="button" disabled={pending} onClick={onCancel} className="mt-4 min-h-11 w-full rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-green-800 hover:bg-green-50 disabled:opacity-50">{t('bets.cancel')}</button> : <p className="mt-4 text-xs text-gray-600">{t('matchBets.yourOffer')}</p> : null}
  </article>
}
