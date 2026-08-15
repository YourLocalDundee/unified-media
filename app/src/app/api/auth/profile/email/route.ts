/**
 * PATCH /api/auth/profile/email — changes the authenticated user's email.
 *
 * Email is stored in lowercase and must be unique across all users. No
 * verification email is sent on change — the new address is trusted immediately.
 * If re-verification were required in the future, this route would need to
 * create a pending_email_changes record instead of writing directly to users.
 *
 * 409 Conflict is returned (not 400) so the client can distinguish "already
 * in use" from other validation errors and show an appropriate message. That 409 is also an
 * account-enumeration oracle — it confirms whether an arbitrary address belongs to an existing
 * user — which is why this route is rate-limited. GET /api/auth/check-username carries a
 * dedicated limiter for the same reason; this is its missing counterpart.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getDb } from '@/lib/db/index'

export async function PATCH(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  // Keyed by userId, not IP: the caller is authenticated, and an attacker probing addresses
  // would otherwise just rotate IPs. Changing your own email is a rare action, so 10/hr is
  // generous for real use and useless as an enumeration loop.
  const rl = checkRateLimit(`profile-email:${session.userId}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl, 'Too many attempts. Try again later.')

  let body: { email?: unknown }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const email = body.email
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }
  const trimmed = email.trim().toLowerCase()

  const db = getDb()
  // Exclude the current user's own ID so they can "update" to the same email
  // they already have (e.g. to normalize casing) without a spurious conflict.
  // email is stored lowercased on every write, so compare the bare (UNIQUE-indexed) column to a
  // lowercased bind — LOWER(email) would defeat the index and force a full scan (C-1).
  const conflict = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(trimmed, session.userId)
  if (conflict) {
    return NextResponse.json({ error: 'That email address is already in use' }, { status: 409 })
  }

  db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
    .run(trimmed, Date.now(), session.userId)

  return NextResponse.json({ ok: true })
}
