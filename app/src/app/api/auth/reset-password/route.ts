/**
 * POST /api/auth/reset-password — validates a password-reset token and sets
 * the new password. Called from /reset-password?token=... after the user
 * clicks the emailed link.
 *
 * The raw token from the URL is SHA-256 hashed and compared against the stored
 * hash — the DB never holds the raw token, so a DB dump cannot yield valid links.
 *
 * On success: marks the reset row `used = 1`, updates the password hash,
 * clears force_pw_change, and deletes ALL sessions for the user so any
 * previously stolen session cannot persist after the credential change.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { validatePassword, hashPassword } from '@/lib/password'
import { checkRateLimit } from '@/lib/rate-limit'
import { createHash } from 'crypto'
import { verifyOrigin } from '@/lib/csrf'

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

interface ResetRow { id: string; user_id: string; token_hash: string; expires_at: number; used: number }
interface UserRow { username: string }

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ip = getClientIp(req)
  const rl = checkRateLimit(`reset-password:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  let body: { token?: string; password?: string; confirmPassword?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }) }

  const { token, password, confirmPassword } = body
  if (!token || !password || !confirmPassword) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 })
  }

  // Hash the raw token before the DB lookup — the stored hash cannot be used to
  // reconstruct the URL parameter even with direct DB access.
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const db = getDb()
  const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(tokenHash) as ResetRow | undefined

  // `reset.used` check prevents replay — a link used once cannot be used again
  // even within the 1-hour window. Expiry is re-checked server-side in addition
  // to the DB column so there is no reliance on the client's clock.
  if (!reset || reset.used || Date.now() > reset.expires_at) {
    return NextResponse.json({ error: 'Reset link is invalid or expired.' }, { status: 400 })
  }

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(reset.user_id) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 400 })

  const pwResult = validatePassword(password, user.username)
  if (!pwResult.valid) return NextResponse.json({ errors: pwResult.errors }, { status: 400 })

  const hash = await hashPassword(password)
  const now = Date.now()

  // Mark used before updating the password so a concurrent request with the same
  // token fails on the used check rather than racing to write the hash twice.
  db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(tokenHash)
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ?, force_pw_change = 0 WHERE id = ?').run(hash, now, reset.user_id)
  // Nuke all sessions — if an attacker triggered this reset, any active sessions
  // they may hold are immediately invalidated along with legitimate ones.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id)

  return NextResponse.json({ ok: true })
}
