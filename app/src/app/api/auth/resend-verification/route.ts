import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendEmail, buildVerificationEmail } from '@/lib/email'

function makeCode(): string {
  const array = new Uint8Array(6)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b % 10).join('')
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

interface PendingRow { id: string; email: string; username: string; expires_at: number }

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = checkRateLimit(`resend-verification:${ip}`, 3, 10 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many resend attempts. Try again in a few minutes.' }, { status: 429 })
  }

  let body: { pendingId?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }) }

  if (!body.pendingId) return NextResponse.json({ error: 'Missing pendingId.' }, { status: 400 })

  const db = getDb()
  const pending = db.prepare('SELECT id, email, username, expires_at FROM pending_registrations WHERE id = ?').get(body.pendingId) as PendingRow | undefined

  if (!pending || Date.now() > pending.expires_at) {
    return NextResponse.json({ error: 'Verification session expired. Please register again.' }, { status: 400 })
  }

  const code = makeCode()
  const expiresAt = Date.now() + 10 * 60 * 1000

  db.prepare('UPDATE pending_registrations SET code = ?, attempts = 0, expires_at = ? WHERE id = ?').run(code, expiresAt, pending.id)

  const emailPayload = buildVerificationEmail(code, pending.username)
  emailPayload.to = pending.email
  await sendEmail(emailPayload)

  return NextResponse.json({ ok: true })
}
