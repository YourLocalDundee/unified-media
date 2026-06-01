import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { createHash, randomBytes } from 'crypto'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

interface UserRow { id: string; username: string; email: string }

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = checkRateLimit(`forgot:${ip}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    // Return 200 regardless to not leak rate-limit info
    return NextResponse.json({ ok: true })
  }

  let body: { email?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ ok: true }) }

  const email = body.email?.trim().toLowerCase()
  if (!email) return NextResponse.json({ ok: true })

  const db = getDb()
  const user = db.prepare('SELECT id, username, email FROM users WHERE LOWER(email) = ? AND is_active = 1').get(email) as UserRow | undefined

  // Always return 200 — never reveal whether email exists
  if (!user) return NextResponse.json({ ok: true })

  const now = Date.now()
  // Clean up old tokens for this user
  db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(user.id, now)

  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = now + 60 * 60 * 1000 // 1 hour

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
