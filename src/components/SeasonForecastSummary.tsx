import { useTranslation } from 'react-i18next'
import { decisiveSeasonChances, type SeasonForecast } from '../lib/seasonForecast'

export function SeasonForecastSummary({ forecast, names }: { forecast: SeasonForecast; names: readonly [string, string] }) {
  const { t } = useTranslation()
  const decisive = decisiveSeasonChances(forecast)
  return <div className="space-y-1 text-sm" aria-label={t('leagueDuel.seasonForecastTitle')}>
    <p className="font-semibold text-green-950">{t('leagueDuel.seasonForecastTitle')}</p>
    <p>{t('leagueDuel.seasonChances', { home: names[0], away: names[1], homePercent: (forecast.homeWinProbability * 100).toFixed(1), awayPercent: (forecast.awayWinProbability * 100).toFixed(1) })}</p>
    {forecast.totalGames % 2 === 0 ? <p>{t('leagueDuel.tieChance', { percent: (forecast.tieProbability * 100).toFixed(1) })}</p> : null}
    {forecast.totalGames % 2 === 0 && decisive ? <p>{t('leagueDuel.decisiveChances', { home: names[0], away: names[1], homePercent: (decisive.home * 100).toFixed(1), awayPercent: (decisive.away * 100).toFixed(1) })}</p> : null}
    <p>{t('leagueDuel.expectedWins', { home: names[0], away: names[1], homeWins: forecast.expectedHomeWins.toFixed(1), awayWins: forecast.expectedAwayWins.toFixed(1) })}</p>
    <p className="text-xs text-gray-600">{t('leagueDuel.forecastCoverage', { total: forecast.totalGames, remaining: forecast.remainingGames })}</p>
    <p className="text-xs text-gray-500">{t('leagueDuel.forecastHelp')}</p>
  </div>
}
