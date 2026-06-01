import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const db = getDb()

  const users = db.prepare(`
    SELECT
      u.id, u.username, u.email, u.role, u.is_active,
      u.first_name, u.last_name, u.location,
      u.created_at, u.last_login,
      (SELECT COUNT(*) FROM watch_events WHERE user_id = u.id) AS watch_count,
      (SELECT MAX(started_at) FROM watch_events WHERE user_id = u.id) AS last_watch,
      (SELECT item_title FROM watch_events WHERE user_id = u.id ORDER BY started_at DESC LIMIT 1) AS last_watch_title,
      (SELECT ip_address FROM sessions WHERE user_id = u.id ORDER BY last_seen DESC LIMIT 1) AS last_ip,
      (SELECT country FROM audit_log WHERE user_id = u.id AND ip_address IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS last_country,
      (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?) AS active_sessions
    FROM users u
    ORDER BY u.created_at DESC
  `).all(Date.now())

  return NextResponse.json({ users })
}
