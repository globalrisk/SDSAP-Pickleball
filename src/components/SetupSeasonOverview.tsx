import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { PicklePreview } from '../lib/picklePoints'
import type { Season, TeamWithPlayers } from '../types'
import type { SetupSection } from '../lib/setupWorkspace'
import { SetupSectionIcon } from './SetupWorkspace'

export function SetupSeasonOverview({ season, rosterCount, teams, fixtureCount, completedCount, preview, isLoading, onSectionChange, leaguePath, canCreateSeason, onCreateSeason }: {
  season: Season
  rosterCount: number
  teams: TeamWithPlayers[]
  fixtureCount: number
  completedCount: number
  preview?: PicklePreview
  isLoading: boolean
  onSectionChange: (section: SetupSection) => void
  leaguePath: (path: string) => string
  canCreateSeason: boolean
  onCreateSeason: () => void
}) {
  const { t } = useTranslation()
  const isDuel = season.format === 'team_duel'
  const archived = season.status === 'archived'
  const complete = fixtureCount > 0 && completedCount === fixtureCount
  const nextSection = rosterCount === 0 ? 'roster' : teams.length < 2 || (isDuel && fixtureCount === 0) ? 'teams' : isDuel && !preview?.configured ? 'prizes' : complete ? 'finish' : null
  const tasks: { section: SetupSection; detail: string; done: boolean }[] = [
    { section: 'roster', detail: t(isDuel && fixtureCount > 0 ? 'workspace.rosterFrozen' : 'workspace.rosterCount', { count: rosterCount }), done: rosterCount > 0 },
    { section: 'teams', detail: fixtureCount > 0 ? t('workspace.teamsAndFixtures', { count: teams.length, fixtures: fixtureCount }) : t('workspace.teamsCount', { count: teams.length }), done: teams.length >= 2 && fixtureCount > 0 },
    ...(isDuel ? [{ section: 'prizes' as const, detail: t(preview?.awarded ? 'workspace.prizesAwarded' : preview?.configured ? 'workspace.prizesSaved' : 'workspace.prizesNeedSaving'), done: !!preview?.configured }] : []),
    { section: 'finish', detail: t(archived ? 'workspace.seasonFinal' : 'workspace.resultsProgress', { completed: completedCount, total: fixtureCount }), done: archived },
  ]
  return <>
    <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-green-800">
      <span>{t(isDuel ? 'leagueDuel.title' : 'leagueDuel.roundRobin')}</span><span aria-hidden="true">·</span>
      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${archived ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800'}`}>{t(archived ? 'workspace.archived' : 'workspace.active')}</span>
    </div>
    {isLoading ? <p role="status" className="mb-6 text-sm text-gray-600">{t('common.loading')}</p> : <section className="mb-6 rounded-xl border border-green-200 bg-white p-4 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5">
      <div className="min-w-0"><h2 className="font-bold text-green-950">{t(archived ? 'workspace.archivedOverviewTitle' : nextSection ? `workspace.next.${nextSection}.title` : fixtureCount === 0 ? 'workspace.next.schedule.title' : 'workspace.next.play.title')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t(archived ? 'workspace.archivedOverviewHelp' : nextSection ? `workspace.next.${nextSection}.help` : fixtureCount === 0 ? 'workspace.next.schedule.help' : 'workspace.next.play.help')}</p></div>
      {archived ? <button type="button" onClick={() => onSectionChange('teams')} className="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white sm:mt-0 sm:w-auto">{t('workspace.viewSeason')}</button>
        : nextSection ? <button type="button" onClick={() => onSectionChange(nextSection)} className="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white sm:mt-0 sm:w-auto">{t(`workspace.next.${nextSection}.action`)}</button>
          : <Link to={leaguePath(fixtureCount === 0 ? '/matches' : '/live')} className="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white sm:mt-0 sm:w-auto">{t(fixtureCount === 0 ? 'workspace.next.schedule.action' : 'workspace.next.play.action')}</Link>}
    </section>}
    <h2 className="mb-2 text-base font-bold text-green-950">{t('workspace.seasonGroup')}</h2>
    <ul className="divide-y divide-green-100">{tasks.map(task => <li key={task.section} className="flex items-center gap-3 py-4">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${task.done ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}><SetupSectionIcon section={task.section} /></span>
      <div className="min-w-0 flex-1"><h3 className="font-semibold text-green-950">{t(`workspace.sections.${task.section}`)}</h3><p className="mt-0.5 text-xs text-gray-600">{isLoading ? t('common.loading') : task.detail}</p></div>
      <button type="button" aria-label={t('workspace.openSection', { section: t(`workspace.sections.${task.section}`) })} onClick={() => onSectionChange(task.section)} className="min-h-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-green-800 hover:bg-green-50">{t(task.done || archived ? 'workspace.view' : 'workspace.review')} <span aria-hidden="true">›</span></button>
    </li>)}</ul>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-green-100 pt-4">
      <button type="button" onClick={onCreateSeason} disabled={!canCreateSeason} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-green-800 hover:bg-green-50 disabled:opacity-50">{t('workspace.createSeason')}</button>
      <button type="button" onClick={() => onSectionChange('members')} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-green-800 hover:bg-green-50">{t('workspace.sections.members')} ›</button>
    </div>
    {!canCreateSeason ? <p className="mt-1 text-xs text-gray-600">{t('workspace.archiveBeforeCreate')}</p> : null}
  </>
}
