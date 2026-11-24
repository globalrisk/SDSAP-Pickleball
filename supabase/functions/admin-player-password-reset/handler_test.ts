import { createClient } from 'npm:@supabase/supabase-js@2.110.1'
import { createPasswordResetHandler } from './handler.ts'

const adminId = 'e6abc343-09f9-44cc-8a83-b35583806e69'
const playerId = '00587f8e-c0e8-4837-b4e1-c4ce710985a8'
const email = 'player@example.test'
const password = 'Synthetic-password-52'
const token = 'synthetic-session'

function setup({ callerRole = 'admin', targetRole = 'player', targetEmail = email, weak = false } = {}) {
  const calls: string[] = []
  const client = createClient('https://api.example.test', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        const path = new URL(request.url).pathname
        calls.push(`${request.method} ${path}`)

        if (path === '/auth/v1/user') {
          if (request.headers.get('Authorization') !== `Bearer ${token}`) {
            return Response.json({ error_code: 'bad_jwt' }, { status: 401 })
          }
          return Response.json({ id: adminId, app_metadata: { role: callerRole }, user_metadata: { role: 'admin' } })
        }
        if (path !== `/auth/v1/admin/users/${playerId}`) return Response.json({}, { status: 404 })
        const target = { id: playerId, email: targetEmail, app_metadata: { role: targetRole } }
        if (request.method === 'GET') return Response.json(target)
        const body = await request.json()
        if (body.password !== password || Object.keys(body).length !== 1) {
          throw new Error('Auth update must contain only the new password')
        }
        return weak ? Response.json({ error_code: 'weak_password' }, { status: 422 }) : Response.json(target)
      },
    },
  })
  return { run: createPasswordResetHandler(client.auth), calls }
}

function resetRequest(authorization: string | null = `Bearer ${token}`) {
  return new Request('https://functions.example.test/reset', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: JSON.stringify({ userId: playerId, email, password }),
  })
}

async function expectResponse(response: Response, status: number, code?: string) {
  const body = await response.json()
  if (response.status !== status || (code ? body.code !== code : body.ok !== true)) {
    throw new Error(`Expected ${status} ${code ?? 'ok'}, got ${response.status} ${JSON.stringify(body)}`)
  }
}

Deno.test('unauthenticated calls never look up the target', async () => {
  const { run, calls } = setup()
  await expectResponse(await run(resetRequest(null)), 401, 'signIn')
  if (calls.length) throw new Error('Missing token reached Auth')
  await expectResponse(await run(resetRequest('Bearer invalid-session')), 401, 'signIn')
  if (calls.length !== 1 || calls[0] !== 'GET /auth/v1/user') throw new Error('Invalid token reached target lookup')
})

Deno.test('user-editable admin metadata does not grant reset access', async () => {
  const { run, calls } = setup({ callerRole: 'player' })
  await expectResponse(await run(resetRequest()), 403, 'adminOnly')
  if (calls.length !== 1) throw new Error('Non-admin reached target lookup')
})

Deno.test('a stale target or an administrator target is never updated', async () => {
  const cases = [
    { options: { targetEmail: 'changed@example.test' }, status: 404, code: 'accountChanged' },
    { options: { targetRole: 'admin' }, status: 403, code: 'protectedAccount' },
  ]
  for (const { options, status, code } of cases) {
    const { run, calls } = setup(options)
    await expectResponse(await run(resetRequest()), status, code)
    if (calls.length !== 2) throw new Error('Protected or stale target was updated')
  }
})

Deno.test('a valid administrator applies the password through Auth and only receives success', async () => {
  const { run, calls } = setup()
  const response = await run(resetRequest())
  if (await response.clone().text() !== '{"ok":true}') throw new Error('Response exposed account data')
  await expectResponse(response, 200)
  if (calls.length !== 3 || calls.at(-1) !== `PUT /auth/v1/admin/users/${playerId}`) {
    throw new Error('Expected one Auth password update for the selected account')
  }
})

Deno.test('Supabase password policy errors are returned without sending the password back', async () => {
  const { run } = setup({ weak: true })
  await expectResponse(await run(resetRequest()), 422, 'weakPassword')
})
