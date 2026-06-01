import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id } = await params
  const db = getDb()

  const user = db.prepare(`
    SELECT id, username, email, role, is_active, first_name, last_name, bio, location,
           display_name, created_at, updated_at, last_login, force_pw_change
    FROM users WHERE id = ?
  `).get(id)

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const sessions = db.prepare(`
    SELECT id, ip_address, user_agent, created_at, expires_at, last_seen
    FROM sessions WHERE user_id = ?
    ORDER BY last_seen DESC LIMIT 50
  `).all(id)

  const watches = db.prepare(`
    SELECT id, item_id, item_title, series_title, item_type,
           season_num, episode_num, progress_pct, watched_sec, duration_sec,
           completed, started_at, ended_at
    FROM watch_events WHERE user_id = ?
    ORDER BY started_at DESC LIMIT 100
  `).all(id)

  const auditLog = db.prepare(`
    SELECT id, event_type, details, ip_address, country, city, created_at
    FROM audit_log WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(id)

  const loginAttempts = db.prepare(`
    SELECT ip_address, username, success, created_at
    FROM login_attempts
    WHERE username = (SELECT username FROM users WHERE id = ?)
    ORDER BY created_at DESC LIMIT 50
  `).all(id)

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_watches,
      SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed_watches,
      SUM(COALESCE(watched_sec, 0)) AS total_watched_sec
    FROM watch_events WHERE user_id = ?
  `).get(id)

  return NextResponse.json({ user, sessions, watches, auditLog, loginAttempts, stats })
}
