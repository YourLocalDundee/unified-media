// GET /api/admin/monitoring
// Returns the full user roster with per-user activity aggregates computed in a single
// correlated-subquery SQL pass rather than N+1 API calls from the client.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

// force-dynamic prevents Next.js from caching this route at the CDN layer —
// user activity changes continuously and must always be fresh.
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
      -- Country comes from audit_log because sessions don't store geolocation
      (SELECT country FROM audit_log WHERE user_id = u.id AND ip_address IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS last_country,
      -- active_sessions counts unexpired rows; Date.now() passed as a bind param to avoid re-evaluating per subquery
      (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?) AS active_sessions
    FROM users u
    ORDER BY u.created_at DESC
  `).all(Date.now())

  return NextResponse.json({ users })
}
