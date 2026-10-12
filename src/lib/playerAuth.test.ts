import { beforeEach, describe, expect, it, vi } from 'vitest'

const signup = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { auth: { signUp: signup } } }))
import { signUpPlayer } from './playerAuth'

describe('Player signup', () => {
  beforeEach(() => signup.mockReset())

  it('uses email confirmation without supplying roles or player ownership', async () => {
    signup.mockResolvedValue({ data: { user: { id: 'unconfirmed' }, session: null }, error: null })
    expect(await signUpPlayer(' alex@example.test ', ' keep spaces ', 'http://localhost:5173/leagues/sdsap/login')).toBeNull()
    expect(signup).toHaveBeenCalledWith({
      email: 'alex@example.test', password: ' keep spaces ',
      options: { emailRedirectTo: 'http://localhost:5173/leagues/sdsap/login' },
    })
  })

  it('only proceeds as signed in when Auth actually issues a session', async () => {
    const user = { id: 'player', app_metadata: { provider: 'email' } }
    signup.mockResolvedValue({ data: { user, session: { user } }, error: null })
    expect(await signUpPlayer('alex@example.test', 'password', 'https://example.test/login')).toEqual(user)
  })

  it('propagates disabled signup and delivery errors instead of showing success', async () => {
    for (const code of ['signup_disabled', 'email_provider_disabled', 'email_address_not_authorized', 'over_email_send_rate_limit']) {
      const error = Object.assign(new Error(code), { code })
      signup.mockResolvedValue({ data: { user: null, session: null }, error })
      await expect(signUpPlayer('alex@example.test', 'password', 'https://example.test/login')).rejects.toBe(error)
    }
  })
})
