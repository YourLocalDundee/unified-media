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
