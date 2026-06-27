/**
 * POST /api/auth/forgot-password — initiates a password reset by emailing a
 * signed link containing a raw token. Always returns 200 regardless of whether
 * the email is registered, to prevent user-enumeration attacks.
 *
 * Token design: a 32-byte random hex string (rawToken) is emailed. The DB
 * stores only SHA-256(rawToken) so a DB read cannot reconstruct the link.
 * Token TTL: 1 hour. Old tokens for the same user are deleted before inserting
 * a new one so a user can safely request a second link without confusion.
 *
 * Rate limit: 5 per IP per 15 minutes; also returns 200 on limit to avoid
 * leaking the fact that the IP is throttled.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { sendEmail } from '@/lib/email'
import { createHash, randomBytes } from 'crypto'
import { verifyOrigin } from '@/lib/csrf'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'

interface UserRow { id: string; username: string; email: string }

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ip = getClientIp(req)
  const rl = checkRateLimit(`forgot:${ip}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    // 200 rather than 429 — leaking rate-limit info would confirm the email
    // is being actively targeted and reveal the threshold to an attacker.
    return NextResponse.json({ ok: true })
  }

  let body: { email?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ ok: true }) }

  const email = body.email?.trim().toLowerCase()
  if (!email) return NextResponse.json({ ok: true })

  const db = getDb()
  // email is bound already-lowercased; compare the bare UNIQUE-indexed column (C-1).
  const user = db.prepare('SELECT id, username, email FROM users WHERE email = ? AND is_active = 1').get(email) as UserRow | undefined

  // Always return 200 — never reveal whether email exists
  if (!user) return NextResponse.json({ ok: true })

  const now = Date.now()
  // Remove previous tokens for this user (prevents confusion from multiple active
  // links) and any globally expired tokens (opportunistic cleanup, no cron job).
  db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, now)

  const rawToken = randomBytes(32).toString('hex')
  // Only the hash is stored; the raw token exists only in the email link. If the
  // DB is compromised, an attacker cannot reconstruct valid reset URLs.
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = now + 60 * 60 * 1000 // 1 hour

  // id is the first 16 hex chars of rawToken — unique enough for a primary key
  // and stable to generate without a separate random ID.
  db.prepare(
    'INSERT INTO password_resets (id, user_id, token_hash, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(rawToken.slice(0, 16), user.id, tokenHash, expiresAt, now)

  const resetLink = `${APP_URL}/reset-password?token=${rawToken}`

  await sendEmail({
    to: user.email,
    subject: 'Unified Media — reset your password',
    text: `Hi ${user.username},\n\nYou requested a password reset. Click the link below (valid for 1 hour):\n\n${resetLink}\n\nIf you didn't request this, ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
        <h2>Unified Media</h2>
        <p>Hi <strong>${user.username}</strong>,</p>
        <p>You requested a password reset. Click below to set a new password (link valid for <strong>1 hour</strong>):</p>
        <a href="${resetLink}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
        <p style="color:#555;">Or paste this link: ${resetLink}</p>
        <p style="color:#888;font-size:12px;">If you didn't request this, ignore this email — your password won't change.</p>
      </div>
    `,
  })

  return NextResponse.json({ ok: true })
}
