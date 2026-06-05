// Admin overview page — rendered server-side so it can query the SQLite DB directly
// without a round-trip through an API route. All data is point-in-time on load.

import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { formatDate } from '@/lib/utils'

interface StatRow { c: number }
interface AuditRow {
  id: number; username: string | null; event_type: string;
  details: string | null; ip_address: string | null; country: string | null; created_at: number
}
interface SessionRow { username: string; ip_address: string | null; last_seen: number }
interface WatchDayRow { day: number; count: number }

const EVENT_ICONS: Record<string, string> = {
  login_success: '✓', login_failure: '✗', logout: '→', user_created: '+',
  user_suspended: '⊘', user_activated: '◉', invite_created: '✉', invite_used: '✉',
  invite_revoked: '✗', password_changed: '🔑', watch_started: '▶', watch_completed: '■',
  admin_action: '⚡',
}

export default async function AdminOverviewPage() {
  await requireAdmin()
  const db = getDb()
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('user') as StatRow).c
  const activeToday = (db.prepare(
    'SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE last_seen > ?'
  ).get(now - dayMs) as StatRow).c
  const totalWatchSec = (db.prepare(
    'SELECT COALESCE(SUM(watched_sec), 0) as c FROM watch_events'
  ).get() as StatRow).c
  const totalWatchHours = Math.round(totalWatchSec / 3600)

  const mostWatched = db.prepare(
    `SELECT item_title, series_title, COUNT(*) as c
     FROM watch_events WHERE started_at > ?
     GROUP BY item_id ORDER BY c DESC LIMIT 1`
  ).get(now - 30 * dayMs) as { item_title: string; series_title: string | null; c: number } | undefined

  const recentAudit = db.prepare(
    `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20`
  ).all() as AuditRow[]

  // "Active now" means last seen within the last 5 minutes
  const activeSessions = db.prepare(
    `SELECT s.last_seen, s.ip_address, u.username
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.last_seen > ? ORDER BY s.last_seen DESC`
  ).all(now - 5 * 60 * 1000) as SessionRow[]

  // Group by integer day (epoch ms / ms-per-day) so bars align with calendar days
  const watchDays = db.prepare(
    `SELECT (started_at / 86400000) as day, COUNT(*) as count
     FROM watch_events WHERE started_at > ?
     GROUP BY day ORDER BY day`
  ).all(now - 14 * dayMs) as WatchDayRow[]

  // Avoid division by zero when there are no watch events
  const maxCount = Math.max(...watchDays.map(d => d.count), 1)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Overview</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: totalUsers },
          { label: 'Active Today', value: activeToday },
          { label: 'Watch Hours', value: `${totalWatchHours}h` },
          { label: 'Most Watched (30d)', value: mostWatched ? (mostWatched.series_title ?? mostWatched.item_title) : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-2xl font-bold text-foreground truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Watch volume chart */}
      {watchDays.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Watch Volume (14 days)</h2>
          <div className="flex items-end gap-1 h-20 rounded-xl border border-border bg-card p-4">
            {watchDays.map(d => (
              <div
                key={d.day}
                className="flex-1 bg-primary rounded-t min-w-[4px]"
                style={{ height: `${(d.count / maxCount) * 100}%` }}
                title={`${d.count} watches`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Active sessions */}
      {activeSessions.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Active Now ({activeSessions.length})</h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">User</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">IP</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeSessions.map((s, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium">{s.username}</td>
                    <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{s.ip_address ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDate(new Date(s.last_seen).toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent audit log */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Recent Activity</h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border">
            {recentAudit.map(entry => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-base w-5 text-center flex-shrink-0">{EVENT_ICONS[entry.event_type] ?? '•'}</span>
                <span className="font-medium text-foreground min-w-[80px]">{entry.username ?? 'system'}</span>
                <span className="text-muted-foreground capitalize">{entry.event_type.replace(/_/g, ' ')}</span>
                <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(new Date(entry.created_at).toISOString())}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
