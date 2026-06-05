/**
 * GET /api/auth/check-username?username=... — live availability check used
 * by the registration form's debounced username field.
 *
 * Checks both `users` and active `pending_registrations` so a username that
 * is mid-verification elsewhere is reported as unavailable. The server will
 * re-enforce uniqueness at verify-email time regardless.
 *
 * force-dynamic ensures Next.js never caches the response; a cached "available"
 * reply could let two users register the same username simultaneously.
 * Rate limit: 20 requests per IP per minute (generous for debounce at 500ms).
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = checkRateLimit(`check-username:${ip}`, 20, 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const username = req.nextUrl.searchParams.get('username')
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) return NextResponse.json({ available: false })

  const db = getDb()
  const now = Date.now()
  const inUsers = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)
  const inPending = db.prepare('SELECT id FROM pending_registrations WHERE LOWER(username) = LOWER(?) AND expires_at > ?').get(username, now)
  return NextResponse.json({ available: !inUsers && !inPending })
}
