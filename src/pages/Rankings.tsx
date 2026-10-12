import { useTranslation } from 'react-i18next'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { PlayerRankingsTable } from '../components/PlayerRankingsTable'
import { usePlayerRankings } from '../hooks/usePlayerRankings'
import { useSearchParams } from 'react-router-dom'
import { PicklePointsRankings } from '../components/PicklePointsRankings'
import { useLeague } from '../context/LeagueContext'

function RatingRankings() {
  const { t } = useTranslation()
  const { data: rankings, isError, error, isLoading } = usePlayerRankings()

  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <p className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        {t('rankings.methodNote')}
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <PlayerRankingsTable rows={rankings ?? []} />
      )}
    </div>
  )
}

export function RankingsPage() {
  const { t } = useTranslation()
  const { league } = useLeague()
  const [params, setParams] = useSearchParams()
  const selected = params.get('tab') === 'pickle' ? 'pickle' : 'rating'
  function selectTab(tab: 'rating' | 'pickle') {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (tab === 'rating') next.delete('tab')
      else next.set('tab', tab)
      return next
    }, { replace: true })
  }
  return <div>
    <SetupBanner />
    <PageHeader title={t('rankings.title')} subtitle={selected === 'pickle' ? t('pickle.leagueLeaderboard', { name: league.name }) : t('rankings.subtitle')} />
    <div role="tablist" aria-label={t('rankings.title')} className="mb-4 flex gap-2 rounded-xl border border-green-200 bg-white p-1">
      {(['rating', 'pickle'] as const).map((tab) => <button key={tab} id={`rankings-tab-${tab}`} type="button" role="tab" aria-selected={selected === tab} aria-controls={`rankings-panel-${tab}`} tabIndex={selected === tab ? 0 : -1}
        onClick={() => selectTab(tab)} onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const next = event.key === 'Home' ? 'rating' : event.key === 'End' ? 'pickle' : tab === 'rating' ? 'pickle' : 'rating'
            selectTab(next)
            document.getElementById(`rankings-tab-${next}`)?.focus()
          }
        }} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${selected === tab ? 'bg-green-700 text-white' : 'text-green-800 hover:bg-green-50'}`}>
        {t(tab === 'rating' ? 'pickle.ratingTab' : 'pickle.pointsTab')}
      </button>)}
    </div>
    <div id="rankings-panel-rating" role="tabpanel" aria-labelledby="rankings-tab-rating" tabIndex={0} hidden={selected !== 'rating'}>
      {selected === 'rating' ? <RatingRankings /> : null}
    </div>
    <div id="rankings-panel-pickle" role="tabpanel" aria-labelledby="rankings-tab-pickle" tabIndex={0} hidden={selected !== 'pickle'}>
      {selected === 'pickle' ? <PicklePointsRankings /> : null}
    </div>
  </div>
}
