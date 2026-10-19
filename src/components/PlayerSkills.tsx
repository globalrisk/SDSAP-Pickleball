import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { usePlayerSkills } from '../hooks/usePlayerSkills'
import { SKILL_GROUPS, parseSkillDraft, skillDraft, type MySkillRating, type SkillGroup, type SkillSummary } from '../lib/playerSkills'
import { removeSkillRating, saveSkillRating } from '../lib/playerSkillsApi'
import { SkillRadarChart } from './SkillRadarChart'

const button = 'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60'

export function PlayerSkills({ playerId }: { playerId: string }) {
  const { t } = useTranslation()
  const { summary, mine, account, user, authLoading, leagueId } = usePlayerSkills(playerId)
  const titleId = useId()
  return <section aria-labelledby={titleId} className="rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
    <h2 id={titleId} className="text-lg font-bold text-green-950">{t('skills.title')}</h2>
    <p className="mt-1 text-sm text-gray-600">{t('skills.subtitle')}</p>
    <details className="mt-3 rounded-lg border border-green-100 p-3">
      <summary className="cursor-pointer rounded text-sm font-semibold text-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">{t('skills.about')}</summary>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">{t('skills.distinctions')}</p>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">{SKILL_GROUPS.map(group => <div key={group.id}>
        <h3 className="font-semibold text-green-950">{t(`skills.groups.${group.id}`)}</h3>
        <dl className="mt-2 space-y-3">{group.skills.map(skill => <div key={skill}><dt className="text-sm font-semibold text-green-950">{t(`skills.names.${skill}`)}</dt><dd className="mt-0.5 text-sm leading-relaxed text-gray-600">{t(`skills.descriptions.${skill}`)}</dd></div>)}</dl>
      </div>)}</div>
    </details>
    {summary.isPending ? <p role="status" className="py-6 text-sm text-gray-600">{t('common.loading')}</p> : summary.isError ? <SkillRetry message={t('skills.loadError')} retry={() => void summary.refetch()} /> : <>
      <p className="mt-3 text-sm font-semibold text-green-800">{t('skills.raters', { count: summary.data.raterCount })}</p>
      {summary.data.raterCount === 0 ? <p className="mt-2 text-sm text-gray-600">{t('skills.empty')}</p> : null}
      <div className="mt-4 grid gap-5 lg:grid-cols-2">{SKILL_GROUPS.map(group => <SkillGroupPanel key={group.id} group={group} summary={summary.data} />)}</div>
    </>}
    <div className="mt-4 border-t border-green-100 pt-4">
      {authLoading ? <p role="status" className="text-sm text-gray-600">{t('common.loading')}</p> : !user ? <p className="text-sm text-gray-600">{t('skills.signIn')}</p> : account.isError ? <SkillRetry message={t('skills.accountError')} retry={() => void account.refetch()} /> : account.isPending || mine.isPending ? <p role="status" className="text-sm text-gray-600">{t('common.loading')}</p> : mine.isError ? <SkillRetry message={t('skills.ratingError')} retry={() => void mine.refetch()} /> : <SkillRatingEditor key={`${user.id}:${account.data?.playerId ?? 'unlinked'}:${leagueId}:${playerId}`} leagueId={leagueId} playerId={playerId} rating={mine.data} />}
    </div>
  </section>
}

function SkillGroupPanel({ group, summary }: { group: SkillGroup; summary: SkillSummary }) {
  const { t } = useTranslation()
  const headingId = useId()
  return <section aria-labelledby={headingId} className="min-w-0 rounded-xl border border-green-100 p-3 sm:p-4">
    <h3 id={headingId} className="font-bold text-green-950">{t(`skills.groups.${group.id}`)}</h3>
    <p className="mt-1 text-xs font-semibold text-green-700">{t('skills.raters', { count: summary.groupRaterCounts[group.id] })}</p>
    <SkillRadarChart group={group} summary={summary} />
    <dl className="grid grid-cols-2 gap-2">{group.skills.map(skill => {
      const { average, count } = summary.skills[skill]
      return <div key={skill} className="min-w-0 rounded-lg bg-green-50/70 p-3">
        <dt className="text-sm font-semibold text-green-950">{t(`skills.names.${skill}`)}</dt>
        <dd className="mt-1 text-xl font-bold tabular-nums text-green-800">{average == null ? <span className="text-sm font-normal text-gray-500">{t('skills.notRated')}</span> : <>{average}<span className="text-xs font-normal text-gray-500"> / 100</span></>}</dd>
        <dd className="mt-1 text-xs text-gray-500">{t('skills.votes', { count })}</dd>
      </div>
    })}</dl>
  </section>
}

function SkillRetry({ message, retry }: { message: string; retry: () => void }) {
  const { t } = useTranslation()
  return <div className="py-3"><p role="alert" className="text-sm text-red-700">{message}</p><button type="button" onClick={retry} className={`${button} mt-2 text-green-800 underline`}>{t('me.retry')}</button></div>
}

function SkillRatingEditor({ playerId, leagueId, rating }: { playerId: string; leagueId: string; rating: MySkillRating }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => skillDraft(rating.scores))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const firstInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (editing) firstInput.current?.focus() }, [editing, rating.canRate])
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ['player-skills', playerId] }),
    client.invalidateQueries({ queryKey: ['player-skill-rating'] }),
  ])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const scores = parseSkillDraft(draft)
    if (!scores || !event.currentTarget.checkValidity()) { setError(t('skills.validation')); return }
    setPending(true); setError(''); setNotice('')
    try {
      await saveSkillRating(leagueId, playerId, scores)
      await refresh()
      setEditing(false); setNotice(t('skills.saved'))
    } catch {
      setError(t('skills.saveError'))
      void refresh()
    } finally { setPending(false) }
  }
  const remove = async () => {
    setPending(true); setError(''); setNotice('')
    try {
      await removeSkillRating(playerId)
      await refresh()
      setEditing(false); setDraft(skillDraft(null)); setNotice(t('skills.removed'))
    } catch { setError(t('skills.removeError')) } finally { setPending(false) }
  }
  return <div>
    {!rating.canRate ? <p className="text-sm text-gray-600">{t(`skills.eligibility.${rating.reason}`)}</p> : null}
    {rating.canRate && !editing ? <button type="button" className={`${button} bg-green-700 text-white hover:bg-green-800`} onClick={() => { setDraft(skillDraft(rating.scores)); setError(''); setNotice(''); setEditing(true) }}>{t(rating.scores ? 'skills.edit' : 'skills.rate')}</button> : null}
    {editing && rating.canRate ? <form onSubmit={event => void submit(event)} className="space-y-4" noValidate aria-label={t('skills.formTitle')}>
      <div><h3 className="font-semibold text-green-950">{t('skills.formTitle')}</h3><p id={`${id}-help`} className="mt-1 text-sm text-gray-600">{t('skills.formHelp')}</p></div>
      {SKILL_GROUPS.map(group => <fieldset key={group.id} disabled={pending} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}>
        <legend className="mb-3 font-bold text-green-950">{t(`skills.groups.${group.id}`)}</legend>
        {group.skills.map(skill => <div key={skill}>
          <label htmlFor={`${id}-${skill}`} className="mb-1 block text-sm font-semibold text-green-950">{t(`skills.names.${skill}`)}</label>
          <input ref={skill === 'drive' ? firstInput : undefined} id={`${id}-${skill}`} type="number" inputMode="numeric" min="0" max="100" step="1" placeholder="—" value={draft[skill]} aria-describedby={`${id}-${skill}-help`} onChange={event => { setDraft(previous => ({ ...previous, [skill]: event.target.value })); setError('') }} className="min-h-11 w-full rounded-lg border border-green-200 bg-white px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600" />
          <p id={`${id}-${skill}-help`} className="mt-1 text-xs leading-relaxed text-gray-600">{t(`skills.descriptions.${skill}`)}</p>
        </div>)}
      </fieldset>)}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={`${button} bg-green-700 text-white hover:bg-green-800`}>{t(pending ? 'skills.saving' : 'skills.save')}</button>
        <button type="button" disabled={pending} onClick={() => { setEditing(false); setError('') }} className={`${button} border border-green-200 text-green-800`}>{t('common.cancel')}</button>
      </div>
    </form> : null}
    {rating.scores ? <button type="button" disabled={pending} onClick={() => void remove()} className={`${button} mt-2 text-red-700 underline`}>{t(pending ? 'skills.saving' : 'skills.remove')}</button> : null}
    {error ? <p id={`${id}-error`} role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="mt-3 text-sm font-semibold text-green-800">{notice}</p> : null}
  </div>
}
