/**
 * POST /api/auth/profile/sessions/revoke-others — signs out all other active
 * sessions for the authenticated user, keeping only the current one alive.
 *
 * Used from the sessions UI when the user wants to ensure no other device is
 * logged in (e.g. after suspecting unauthorized access). The current session
 * is identified by session.sessionId so the user is never self-locked out.
 *
 * No body is required; the session ID is taken from the validated cookie via
 * requireAuth() — there is nothing the caller can forge to widen the blast radius.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getDb } from '@/lib/db/index'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()
  const db = getDb()
  // The `AND id != ?` exclusion ensures the current session is never deleted,
  // regardless of how many sessions exist for the user.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .run(session.userId, session.sessionId)
  return NextResponse.json({ ok: true })
}
