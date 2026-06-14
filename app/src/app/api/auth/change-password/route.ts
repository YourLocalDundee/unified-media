/**
 * POST /api/auth/change-password — used by the /change-password page for
 * admin-forced password resets (force_pw_change flow).
 *
 * Unlike the profile change-password route, this is called while the user has
 * no session cookie (the login route withheld it). requireAuth() here still
 * works because the user has an active session from a prior login — force_pw_change
 * does not delete the session, it just redirects before the session cookie is set.
 *
 * On success: clears force_pw_change, keeps the current session alive, and
 * revokes all OTHER sessions (i.e. old ones from before the admin reset).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession, logEvent } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit } from '@/lib/rate-limit'
import { validatePassword, verifyPassword, hashPassword } from '@/lib/password'
import { getDb } from '@/lib/db/index'

interface UserRow { password_hash: string }

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // getSession() rather than requireAuth(): this is the only authed route a
  // force_pw_change user is allowed to reach, so it must NOT redirect them to
  // /change-password (requireAuth now does). It returns a clean 401 JSON instead
  // of an opaque redirect for unauthenticated callers (A1-010).
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Throttle online guessing of the admin-issued temp password (A1-007), mirroring
  // the profile change-password limiter: 5 attempts per 15 minutes per user.
  const rl = checkRateLimit(`change-password:${session.userId}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': '900' } }
    )
  }

  let body: { currentPassword?: string; newPassword?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const { currentPassword, newPassword } = body
  if (!currentPassword || !newPassword) return NextResponse.json({ error: 'All fields are required' }, { status: 400 })

  const db = getDb()
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.userId) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const valid = await verifyPassword(currentPassword, user.password_hash)
  if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

  const pwResult = validatePassword(newPassword, session.username)
  if (!pwResult.valid) return NextResponse.json({ errors: pwResult.errors }, { status: 400 })

  const hash = await hashPassword(newPassword)
  db.prepare('UPDATE users SET password_hash = ?, force_pw_change = 0, updated_at = ? WHERE id = ?')
    .run(hash, Date.now(), session.userId)
  // Keep the current session so the user doesn't have to log in again immediately;
  // revoke others in case the admin-created temp password was shared or exposed.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(session.userId, session.sessionId)

  await logEvent('password_changed', {}, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
