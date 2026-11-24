import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { resetPlayerPassword } from '../lib/playerAuth'

type ResetAccount = { email: string; userId: string }

export function PlayerPasswordReset({ email, userId }: ResetAccount) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  return <>
    <button type="button" onClick={() => { setSaved(false); setOpen(true) }}
      className="min-h-11 rounded-lg border border-green-200 px-3 font-bold text-green-800 hover:bg-green-50">
      {t('bets.passwordReset.action')}
    </button>
    {saved ? <p role="status" className="text-sm font-semibold text-green-800">{t('bets.passwordReset.saved')}</p> : null}
    {open ? <PasswordResetDialog email={email} userId={userId}
      onClose={() => setOpen(false)} onSaved={() => setSaved(true)} /> : null}
  </>
}

function PasswordResetDialog({ email, userId, onClose, onSaved }: ResetAccount & { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const password = String(fields.get('password'))
    if (password !== fields.get('confirmation')) {
      setError(t('auth.passwordMismatch'))
      return
    }

    setError(null)
    setPending(true)
    const failure = await resetPlayerPassword(userId, email, password)
    setPending(false)
    if (failure) {
      setError(t(`bets.passwordReset.${failure}`))
      return
    }
    form.reset()
    onSaved()
    dialog.current?.close()
  }

  const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-green-200 px-3 text-base disabled:opacity-60'
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onClose={onClose}
    onCancel={event => { if (pending) event.preventDefault() }}
    className="themed-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-green-200 bg-white p-5 shadow-xl backdrop:bg-green-950/45">
    <h3 id={titleId} className="text-xl font-bold text-green-950">{t('bets.passwordReset.action')}</h3>
    <p id={descriptionId} className="mt-2 break-words text-sm text-gray-600">{t('bets.passwordReset.description', { email })}</p>
    <form onSubmit={event => void submit(event)} className="mt-4 space-y-3">
      <label className="block text-sm font-semibold">{t('me.newPassword')}
        <input type="password" name="password" autoComplete="new-password" required disabled={pending} className={inputClass} />
      </label>
      <label className="block text-sm font-semibold">{t('auth.confirmPassword')}
        <input type="password" name="confirmation" autoComplete="new-password" required disabled={pending} className={inputClass} />
      </label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button type="button" onClick={() => dialog.current?.close()} disabled={pending}
          className="min-h-11 rounded-lg border border-green-200 px-4 text-sm font-bold text-green-800 disabled:opacity-50">{t('common.cancel')}</button>
        <button type="submit" disabled={pending}
          className="min-h-11 rounded-lg bg-green-700 px-4 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50">
          {t(pending ? 'common.loading' : 'bets.passwordReset.action')}
        </button>
      </div>
    </form>
  </dialog>
}
