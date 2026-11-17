// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { expect, it, vi } from 'vitest'
import { ConfirmationContext } from '../lib/confirmation'
import en from '../i18n/locales/en.json'
import { PicklePayoutForm } from './PicklePayoutForm'

const api = vi.hoisted(() => ({ wallet: vi.fn(), payout: vi.fn() }))
vi.mock('../context/LeagueContext', () => ({ useLeague: () => ({ league: { id: 'league', name: 'SDSAP' } }) }))
vi.mock('../lib/picklePointsApi', () => ({ fetchPicklePayoutWallet: api.wallet, recordPicklePayout: api.payout }))

it('reviews a payout without a reason and retries the confirmed request after reopening', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  const wallet = { balance: '5000', reserved: '2000', available: '3000' }
  client.setQueryData(['bets', 'payout-wallet', 'league', 'admin', 'player'], wallet)
  api.wallet.mockResolvedValue(wallet)
  api.payout.mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ id: 'receipt-1', amount: '3000', balanceAfter: '2000' })
  const confirm = vi.fn().mockResolvedValue(true)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = () => root.render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
    <ConfirmationContext.Provider value={confirm}>
      <PicklePayoutForm adminId="admin" player={{ id: 'player', name: 'Trọng', status: 'active', balance: '5000', rank: 1 }} />
    </ConfirmationContext.Provider>
  </I18nextProvider></QueryClientProvider>)
  try {
    await act(async () => render())
    const input = container.querySelector('input')!
    const submit = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!
    async function changeAmount(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await changeAmount('3001')
    expect(submit().disabled).toBe(true)
    expect(container.textContent).toContain(en.picklePayout.errors.PAYOUT_FUNDS)
    await changeAmount('3000')
    await act(async () => submit().click())
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Reserved for bets 2.000'), expect.anything())
    expect(api.payout).toHaveBeenCalledWith('league', 'player', '3000', null, expect.any(String))
    expect(submit().textContent).toBe(en.picklePayout.retry)

    await act(async () => root.render(null))
    await act(async () => render())
    expect(submit().textContent).toBe(en.picklePayout.retry)
    await act(async () => submit().click())
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(api.payout.mock.calls[1]).toEqual(api.payout.mock.calls[0])
    expect(container.textContent).toContain('New balance 2.000 🥒. Receipt receipt-1')
    expect(sessionStorage.length).toBe(0)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    sessionStorage.clear()
    vi.unstubAllGlobals()
  }
})
