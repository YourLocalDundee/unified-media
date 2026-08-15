/**
 * GET /api/auth/profile/sessions — returns all sessions for the current user
 * so the /settings/profile page can show active devices with IP, UA, and
 * timestamps. The currentSessionId is returned alongside so the UI can mark
 * the active session and prevent the user from revoking it via the normal
 * delete flow.
 *
 * force-dynamic ensures the session list is always fresh, not served from a
 * Next.js route cache that might not reflect a recently revoked session.
 */

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { deviceNameFromUserAgent } from '@/lib/device-name'

export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  ip_address: string | null
  user_agent: string | null
  device_name: string | null
  created_at: number
  last_seen: number
  expires_at: number
}

export async function GET() {
  const session = await requireAuth()
  const db = getDb()
  const sessions = db.prepare(
    `SELECT id, ip_address, user_agent, device_name, created_at, last_seen, expires_at
     FROM sessions
     WHERE user_id = ?
     ORDER BY last_seen DESC`
  ).all(session.userId) as SessionRow[]

  // device_name is only written from createSession() onwards, so sessions that predate that
  // have it NULL. Derive on read rather than backfilling in a migration: the same pure
  // function produces the same label either way, and old rows age out within the 30-day TTL.
  const withDevice = sessions.map((s) => ({
    ...s,
    device_name: s.device_name ?? deviceNameFromUserAgent(s.user_agent),
  }))

  return NextResponse.json({ sessions: withDevice, currentSessionId: session.sessionId })
}
