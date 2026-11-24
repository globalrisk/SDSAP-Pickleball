import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.1'

type Auth = Pick<SupabaseClient['auth'], 'getUser'> & {
  admin: Pick<SupabaseClient['auth']['admin'], 'getUserById' | 'updateUserById'>
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

function failure(status: number, code: string): Response {
  return Response.json({ code }, { status, headers })
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function createPasswordResetHandler(auth: Auth | null) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return failure(405, 'methodNotAllowed')
    if (!auth) return failure(503, 'unavailable')

    const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token) return failure(401, 'signIn')
    const { data: { user: caller }, error: callerError } = await auth.getUser(token)
    if (callerError || !caller) return failure(401, 'signIn')
    if (caller.app_metadata.role !== 'admin') return failure(403, 'adminOnly')

    let payload: { userId?: unknown; email?: unknown; password?: unknown }
    try {
      const body = await request.text()
      if (body.length > 8192) return failure(400, 'invalid')
      payload = JSON.parse(body)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return failure(400, 'invalid')
    } catch {
      return failure(400, 'invalid')
    }

    const { userId, email, password } = payload
    if (typeof userId !== 'string' || !uuid.test(userId) || typeof email !== 'string' || !email
      || typeof password !== 'string' || !password || password.length > 1024) return failure(400, 'invalid')

    const { data: { user: target }, error: targetError } = await auth.admin.getUserById(userId)
    if (targetError && targetError.code !== 'user_not_found') return failure(503, 'unavailable')
    if (!target?.email || target.email !== email) return failure(404, 'accountChanged')
    if (target.app_metadata.role === 'admin') return failure(403, 'protectedAccount')

    const { error } = await auth.admin.updateUserById(userId, { password })
    if (error?.code === 'weak_password' || error?.code === 'validation_failed') return failure(422, 'weakPassword')
    if (error?.code === 'same_password') return failure(422, 'samePassword')
    if (error?.code === 'user_not_found') return failure(404, 'accountChanged')
    if (error?.status === 429) return failure(429, 'rateLimited')
    if (error) return failure(503, 'unavailable')

    console.info('Player password reset', { adminId: caller.id, playerAccountId: target.id })
    return Response.json({ ok: true }, { headers })
  }
}
