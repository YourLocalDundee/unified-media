/**
 * POST /api/auth/logout — deletes the server-side session record and clears
 * the unified-session cookie.
 *
 * Deleting from the sessions table is the authoritative logout; clearing the
 * cookie is a UX convenience. A lingering cookie with no matching DB row is
 * treated as unauthenticated by getSession() in dal.ts.
 *
 * The route is idempotent — calling it with no active session is a no-op and
 * still returns 200 so the client can safely fire-and-forget on logout.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession, deleteSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'
import { verifyOrigin } from '@/lib/csrf'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await getSession()
  if (session) {
    await deleteSession(session.sessionId)
    await logEvent('logout', {}, { userId: session.userId, username: session.username })
  }
  const cookieStore = await cookies()
  cookieStore.delete('unified-session')
  return NextResponse.json({ ok: true })
}
