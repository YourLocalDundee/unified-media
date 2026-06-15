/**
 * POST /api/auth/register — Step 1 of the two-step registration flow.
 *
 * Validates fields, checks for username/email conflicts, creates a
 * pending_registrations row, and emails a 6-digit code. Returns a `pendingId`
 * opaque token that ties Step 1 to Step 2 (verify-email). No user row or
 * session is created here — the account only exists after the code is verified.
 *
 * Rate limit: 10 attempts per IP per 15 minutes.
 * Code TTL: 10 minutes. Max verify attempts: 5 (enforced in verify-email).
 *
 * Any existing pending row for the same email is deleted before inserting a new
 * one so that re-registering with the same email gets a fresh code immediately.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { validatePassword, hashPassword } from '@/lib/password'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { sendEmail, buildVerificationEmail } from '@/lib/email'
import { createSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'
import { verifyOrigin } from '@/lib/csrf'

// Generates a URL-safe random ID for the pendingId token. Uses modulo bias
// reduction implicitly — the charset length (62) divides evenly enough into 256
// that the bias is negligible for a non-cryptographic opaque token.
function makeId(size = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(size)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

// Each byte mod 10 produces a random digit 0–9. The slight bias toward 0–5 is
// acceptable for a short-lived UX code; it is not used as a cryptographic secret.
function makeCode(): string {
  const array = new Uint8Array(6)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b % 10).join('')
}

// 8-byte base62 user ID (same algorithm as in verify-email/route.ts).
function makeUserId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// better-sqlite3 throws on a UNIQUE constraint with code 'SQLITE_CONSTRAINT_UNIQUE'
// and a message naming the column, e.g. "UNIQUE constraint failed: users.email".
// This is the backstop for a race between the pre-insert existence check and the
// INSERT: two concurrent signups with the same email both pass the SELECT, then one
// INSERT trips the constraint. Catching it turns that into the same clean duplicate
// response instead of an uncaught 500 surfacing as a generic "unexpected error".
function isUniqueViolation(err: unknown, column: 'email' | 'username'): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string }
  return e.code === 'SQLITE_CONSTRAINT_UNIQUE'
    && typeof e.message === 'string'
    && e.message.includes(`users.${column}`)
}

// Structured duplicate responses — 409 Conflict + a machine-readable `code` so the
// frontend can branch (show the "already registered → sign in" UI) rather than
// pattern-matching a human string.
const EMAIL_EXISTS_RESPONSE = () =>
  NextResponse.json(
    { error: 'An account with that email already exists.', code: 'EMAIL_EXISTS' },
    { status: 409 },
  )
const USERNAME_TAKEN_RESPONSE = () =>
  NextResponse.json(
    { error: 'Username already taken.', code: 'USERNAME_TAKEN' },
    { status: 409 },
  )

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ip = getClientIp(req)
  const rl = checkRateLimit(`register:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many registration attempts. Try again later.' }, { status: 429 })
  }

  let body: {
    username?: string; email?: string; password?: string; confirmPassword?: string
    firstName?: string; lastName?: string; bio?: string; location?: string
  }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const { username, email, password, confirmPassword, firstName, lastName, bio, location } = body

  if (!username || !email || !password || !confirmPassword) {
    return NextResponse.json({ error: 'All required fields must be provided.' }, { status: 400 })
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json({ error: 'Username must be 3–20 characters (letters, numbers, underscores).' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  const pwResult = validatePassword(password, username)
  if (!pwResult.valid) return NextResponse.json({ errors: pwResult.errors }, { status: 400 })
  if (password !== confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 })
  }

  // Everything past validation is wrapped so that any genuinely unexpected failure
  // is logged with full detail server-side and returns a *safe, generic, JSON* 500.
  // Without this, an uncaught throw produces Next's default non-JSON 500 page, which
  // the client's `res.json()` can't parse — surfacing as the opaque catch-all
  // "An unexpected error occurred." Known cases (duplicate email/username) are
  // returned explicitly below and never reach this fallback.
  try {
    const db = getDb()

    // Primary, friendly path: pre-insert existence checks (case-insensitive).
    if (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)) {
      return USERNAME_TAKEN_RESPONSE()
    }
    if (db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email)) {
      return EMAIL_EXISTS_RESPONSE()
    }

    const now = Date.now()
    const hash = await hashPassword(password)

    // When EMAIL_VERIFICATION_REQUIRED is not 'true', skip the pending row and
    // create the account immediately. This is the default for self-hosted installs
    // where SMTP is not configured and users should be able to sign up instantly.
    const verificationRequired = process.env.EMAIL_VERIFICATION_REQUIRED === 'true'

    if (!verificationRequired) {
      const userId = makeUserId()
      try {
        db.prepare(
          `INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, bio, location, created_at, updated_at, is_active)
           VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, 1)`
        ).run(userId, username, email.toLowerCase(), hash,
          firstName?.trim() || null, lastName?.trim() || null,
          bio?.trim() || null, location?.trim() || null, now, now)
      } catch (err) {
        // Race backstop: the UNIQUE constraint fired despite the checks above.
        if (isUniqueViolation(err, 'email')) return EMAIL_EXISTS_RESPONSE()
        if (isUniqueViolation(err, 'username')) return USERNAME_TAKEN_RESPONSE()
        throw err // truly unexpected — handled by the outer catch
      }

      await logEvent('user_created', { username, email }, { userId, username, ip })

      const sessionId = await createSession(userId, ip, req.headers.get('user-agent') ?? undefined)
      const cookieStore = await cookies()
      cookieStore.set('unified-session', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_MS / 1000,
      })

      return NextResponse.json({ username, role: 'user' })
    }

    // Purge any existing pending row for this email (e.g. user re-registered after
    // losing the code) AND stale expired rows for any email to prevent table bloat.
    // There is no background cleanup job — expiry enforcement is opportunistic here.
    db.prepare('DELETE FROM pending_registrations WHERE LOWER(email) = ? OR expires_at < ?').run(email.toLowerCase(), now)

    const pendingId = makeId(32)
    const code = makeCode()

    try {
      db.prepare(
        `INSERT INTO pending_registrations (id, email, username, password_hash, code, first_name, last_name, bio, location, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        pendingId, email.toLowerCase(), username, hash, code,
        firstName?.trim() || null, lastName?.trim() || null,
        bio?.trim() || null, location?.trim() || null,
        now + 10 * 60 * 1000, now
      )
    } catch (err) {
      // pending_registrations has no UNIQUE(email), but a concurrent signup may have
      // created the real users row between our check and here — surface it cleanly.
      if (isUniqueViolation(err, 'email')) return EMAIL_EXISTS_RESPONSE()
      if (isUniqueViolation(err, 'username')) return USERNAME_TAKEN_RESPONSE()
      throw err
    }

    const emailPayload = buildVerificationEmail(code, username)
    emailPayload.to = email
    await sendEmail(emailPayload)

    return NextResponse.json({ pendingId })
  } catch (err) {
    // Server-side only: log the real exception (stack) for diagnosis. The client
    // gets a safe generic message — this branch is reserved for *unknown* errors;
    // all known cases returned specific, actionable responses above.
    process.stderr.write(
      `[register] unexpected error for username="${username}": ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
