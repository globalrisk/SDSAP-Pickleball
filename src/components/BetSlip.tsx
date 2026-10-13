import { useTranslation } from 'react-i18next'
import { addPoints, type PickleBet } from '../lib/betsApi'
import { formatPicklePoints, formatSignedPicklePoints } from '../lib/picklePoints'

export function BetPairSummary({ names, label, highlighted = false }: {
  names: string[]; label: string; highlighted?: boolean
}) {
  return <div className={`min-w-0 rounded-xl p-3 ${highlighted ? 'bg-green-50' : ''}`}>
    <p className={`break-words text-xs font-semibold ${highlighted ? 'text-green-700' : 'text-gray-500'}`}>{label}</p>
    <ul className="mt-2 space-y-1 text-base font-semibold text-green-950">
      {names.map((name, index) => <li key={index} className="[overflow-wrap:anywhere]">{name}</li>)}
    </ul>
  </div>
}

export function BetTerms({ stake, profit, personal = true, showStake = true, live = false }: {
  stake: string; profit: string; personal?: boolean; showStake?: boolean; live?: boolean
}) {
  const { t } = useTranslation()
  return <div className="mt-4" aria-live={live ? 'polite' : undefined}>
    <dl className={`grid gap-4 border-b border-gray-100 pb-4 ${showStake ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {showStake ? <div className="min-w-0">
        <dt className="text-xs text-gray-500">{t(personal ? 'bets.yourStake' : 'betSlip.stakeToAccept')}</dt>
        <dd className="mt-1 text-lg font-semibold text-green-950 tabular-nums [overflow-wrap:anywhere]">{formatPicklePoints(stake)}</dd>
      </div> : null}
      <div className="min-w-0">
        <dt className="text-xs text-gray-500">{t(personal ? 'betSlip.profitIfWon' : 'betSlip.opposingProfit')}</dt>
        <dd className="mt-1 text-lg font-semibold text-green-950 tabular-nums [overflow-wrap:anywhere]">{formatSignedPicklePoints(profit)}</dd>
      </div>
    </dl>
    <dl className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="contents">
        <dt className="text-sm text-gray-700">{t('betSlip.totalReturn')}<span className="mt-1 block text-xs text-gray-500">{t(personal ? 'betSlip.includesStake' : 'betSlip.includesAcceptorStake')}</span></dt>
        <dd className="min-w-0 text-xl font-semibold text-green-950 tabular-nums [overflow-wrap:anywhere]">{formatPicklePoints(addPoints(stake, profit))}</dd>
      </div>
    </dl>
    <p className="mt-3 text-xs text-gray-500">{t(personal ? 'betSlip.ifLost' : 'betSlip.ifOpposingLost', { amount: formatPicklePoints(`-${stake}`) })}</p>
  </div>
}

export function BetAcceptanceDetails({ bet }: { bet: PickleBet }) {
  const { t } = useTranslation()
  const pair = bet.creatorSide === bet.homeTeamId ? bet.awayNames : bet.homeNames
  return <div>
    <BetPairSummary names={pair} label={t('betSlip.youBack')} highlighted />
    <BetTerms stake={bet.acceptorStake} profit={bet.creatorStake} />
  </div>
}
