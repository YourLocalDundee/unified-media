import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  ip_address: string | null
  user_agent: string | null
  created_at: number
  last_seen: number
  expires_at: number
}

export async function GET() {
  const session = await requireAuth()
  const db = getDb()
  const sessions = db.prepare(
    `SELECT id, ip_address, user_agent, created_at, last_seen, expires_at
     FROM sessions
     WHERE user_id = ?
     ORDER BY last_seen DESC`
  ).all(session.userId) as SessionRow[]

  return NextResponse.json({ sessions, currentSessionId: session.sessionId })
}
