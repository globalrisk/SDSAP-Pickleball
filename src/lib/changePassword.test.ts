import { beforeEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ updateUser: vi.fn(), getUser: vi.fn(), signInWithPassword: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { auth } }))
import { changePlayerPassword, validatePasswordChange } from './playerAuth'

beforeEach(() => { vi.resetAllMocks(); auth.updateUser.mockResolvedValue({ error: null }) })
describe('Signed-in password change', () => {
  it('checks required credentials, minimum length and exact confirmation without trimming passwords', () => {
    expect(validatePasswordChange('', 'new-password', 'new-password')).toBe('currentRequired')
    expect(validatePasswordChange('current', 'short', 'short')).toBe('tooShort')
    expect(validatePasswordChange('current', 'new-password', 'different-password')).toBe('mismatch')
    expect(validatePasswordChange('current', ' new-password ', 'new-password')).toBe('mismatch')
    expect(validatePasswordChange('current', ' new-password ', ' new-password ')).toBeNull()
  })
  it('requires current password and eight new characters before contacting Auth', async () => {
    await expect(changePlayerPassword('', 'long-password')).rejects.toThrow('PASSWORD_INVALID')
    await expect(changePlayerPassword('old-password', 'short')).rejects.toThrow('PASSWORD_INVALID')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('verifies the current password on the server and preserves significant spaces', async () => {
    await changePlayerPassword(' old password ', ' new password ')
    expect(auth.updateUser).toHaveBeenCalledWith({ current_password: ' old password ', password: ' new password ' })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })
  it('reauthenticates the same account and retries only once when required', async () => {
    auth.updateUser.mockResolvedValueOnce({ error: { code: 'reauthentication_needed' } })
    auth.getUser.mockResolvedValue({ data: { user: { id: 'player', email: 'player@example.test' } }, error: null })
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'player' } }, error: null })
    await changePlayerPassword('current-password', 'new-password')
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'player@example.test', password: 'current-password' })
    expect(auth.updateUser).toHaveBeenCalledTimes(2)
  })
  it('propagates validation/network errors without retrying or reporting success', async () => {
    for (const code of ['weak_password', 'invalid_credentials', 'same_password', 'over_request_rate_limit']) {
      const error = { code }
      auth.updateUser.mockResolvedValue({ error })
      await expect(changePlayerPassword('current-password', 'new-password')).rejects.toBe(error)
    }
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })
  it('stops after failed reauthentication and never changes another account’s password', async () => {
    auth.updateUser.mockResolvedValue({ error: { code: 'reauthentication_needed' } })
    auth.getUser.mockResolvedValue({ data: { user: { id: 'player', email: 'player@example.test' } }, error: null })
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'other' } }, error: null })
    await expect(changePlayerPassword('current-password', 'new-password')).rejects.toThrow('PASSWORD_SESSION')
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
  })
})
