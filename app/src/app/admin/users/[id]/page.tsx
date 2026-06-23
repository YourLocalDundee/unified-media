// Per-user admin detail page — shows profile, all sessions, full watch history,
// audit log, and login attempts in a five-tab layout. All actions (suspend, reset
// password, role changes, delete) mutate via API routes so they hit the auth layer.
'use client'

import { useState, useEffect, use } from 'react'
import { Loader2, ArrowLeft, Monitor, Film, ScrollText, LogIn, Shield } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { nowMs } from '@/lib/utils'

interface UserDetail {
  id: string; username: string; email: string | null; role: string; is_active: number
  first_name: string | null; last_name: string | null; bio: string | null; location: string | null
  display_name: string | null; created_at: number; updated_at: number; last_login: number | null
  force_pw_change: number
}
interface Session { id: string; ip_address: string | null; user_agent: string | null; created_at: number; expires_at: number; last_seen: number }
interface Watch { id: number; item_title: string; series_title: string | null; item_type: string; season_num: number | null; episode_num: number | null; progress_pct: number | null; watched_sec: number | null; completed: number; started_at: number }
interface AuditEntry { id: number; event_type: string; details: string | null; ip_address: string | null; country: string | null; city: string | null; created_at: number }
interface LoginAttempt { ip_address: string; username: string | null; success: number; created_at: number }
interface Stats { total_watches: number; completed_watches: number; total_watched_sec: number }

interface MonitorData {
  user: UserDetail; sessions: Session[]; watches: Watch[]
  auditLog: AuditEntry[]; loginAttempts: LoginAttempt[]; stats: Stats
}

function fmt(ts: number | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}
function fmtDur(sec: number | null) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // `use(params)` is required in Next.js 15+ because params is a Promise in client components.
  const { id } = use(params)
  const router = useRouter()
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'sessions' | 'watches' | 'audit' | 'logins'>('overview')
  const [actionLoading, setActionLoading] = useState(false)
  // A7-04 / A9-10/11: a failed admin mutation must not silently appear to succeed.
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/users/${id}/monitoring`)
      .then(r => r.json())
      .then(d => setData(d as MonitorData))
      .finally(() => setLoading(false))
  }, [id])

  async function doAction(action: 'suspend' | 'activate' | 'reset-password' | 'force-pw-change' | 'promote' | 'demote') {
    setActionLoading(true)
    setActionError(null)
    try {
      // A7-04: check res.ok on every mutation; throw so a failure is surfaced
      // and the success-only paths (reset-password reveal, re-fetch) are skipped.
      if (action === 'reset-password') {
        const res = await fetch(`/api/admin/users/${id}/reset-password`, { method: 'POST' })
        if (!res.ok) throw new Error(`Reset failed (HTTP ${res.status})`)
        const d = await res.json() as { tempPassword: string }
        alert(`Temporary password: ${d.tempPassword}\n\nShare this with the user — shown once only.`)
      } else if (action === 'suspend' || action === 'activate') {
        const res = await fetch(`/api/admin/users/${id}/${action}`, { method: 'POST' })
        if (!res.ok) throw new Error(`Action failed (HTTP ${res.status})`)
      } else if (action === 'force-pw-change') {
        const res = await fetch(`/api/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force_pw_change: 1 }) })
        if (!res.ok) throw new Error(`Action failed (HTTP ${res.status})`)
      } else if (action === 'promote') {
        const res = await fetch(`/api/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'admin' }) })
        if (!res.ok) throw new Error(`Action failed (HTTP ${res.status})`)
      } else if (action === 'demote') {
        const res = await fetch(`/api/admin/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user' }) })
        if (!res.ok) throw new Error(`Action failed (HTTP ${res.status})`)
      }
      // Re-fetch the full monitoring payload so all tabs reflect the updated state
      const res = await fetch(`/api/admin/users/${id}/monitoring`)
      setData(await res.json() as MonitorData)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setActionLoading(false)
    }
  }

  async function deleteUser() {
    if (!confirm(`Delete user "${data?.user.username}" permanently? This cannot be undone.`)) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
      // A7-04: only navigate away on a confirmed success.
      if (res.ok) router.push('/admin/users')
      else setActionError(`Delete failed (HTTP ${res.status})`)
    } catch {
      setActionError('Delete failed.')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  if (!data) return <div className="text-center py-16 text-muted-foreground">User not found.</div>

  const { user, sessions, watches, auditLog, loginAttempts, stats } = data

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Monitor },
    { id: 'sessions', label: `Sessions (${sessions.length})`, icon: Shield },
    { id: 'watches', label: `Watches (${watches.length})`, icon: Film },
    { id: 'audit', label: `Audit (${auditLog.length})`, icon: ScrollText },
    { id: 'logins', label: `Logins (${loginAttempts.length})`, icon: LogIn },
  ] as const

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/admin/monitoring" className="rounded-lg p-2 hover:bg-muted transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{user.username}</h1>
            {(user.first_name || user.last_name) && (
              <p className="text-sm text-muted-foreground">{[user.first_name, user.last_name].filter(Boolean).join(' ')}</p>
            )}
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {user.is_active ? 'Active' : 'Suspended'}
          </span>
          {user.role === 'admin' && (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-400">Admin</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void doAction(user.is_active ? 'suspend' : 'activate')} disabled={actionLoading}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${user.is_active ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}>
            {user.is_active ? 'Suspend' : 'Activate'}
          </button>
          <button onClick={() => void doAction('reset-password')} disabled={actionLoading}
            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 transition-colors">
            Reset Password
          </button>
          <button onClick={() => void doAction('force-pw-change')} disabled={actionLoading}
            className="rounded-lg px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 transition-colors">
            Force PW Change
          </button>
          {user.role !== 'admin' ? (
            <button onClick={() => void doAction('promote')} disabled={actionLoading}
              className="rounded-lg px-3 py-1.5 text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors">
              Promote to Admin
            </button>
          ) : (
            <button onClick={() => void doAction('demote')} disabled={actionLoading}
              className="rounded-lg px-3 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 transition-colors">
              Demote to User
            </button>
          )}
          {user.role !== 'admin' && (
            <button onClick={() => void deleteUser()} disabled={actionLoading}
              className="rounded-lg px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
              Delete Account
            </button>
          )}
        </div>
      </div>

      {/* A7-04 / A16: failed admin actions are surfaced and announced. */}
      <div aria-live="assertive" className="sr-only">{actionError ?? ''}</div>
      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400">
          {actionError}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map(({ id: tid, label, icon: Icon }) => (
          <button key={tid} onClick={() => setTab(tid as typeof tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${tab === tid ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Profile</h3>
            {[
              ['Username', user.username],
              ['Email', user.email ?? '—'],
              ['Display Name', user.display_name ?? '—'],
              ['First Name', user.first_name ?? '—'],
              ['Last Name', user.last_name ?? '—'],
              ['Location', user.location ?? '—'],
              ['Bio', user.bio ?? '—'],
              ['Role', user.role],
              ['Force PW Change', user.force_pw_change ? 'Yes' : 'No'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm gap-4">
                <span className="text-muted-foreground shrink-0">{k}</span>
                <span className="text-right break-all">{v}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Activity Stats</h3>
            {[
              ['Joined', fmt(user.created_at)],
              ['Last Login', fmt(user.last_login)],
              ['Total Watches', String(stats.total_watches)],
              ['Completed', String(stats.completed_watches)],
              ['Total Watch Time', fmtDur(stats.total_watched_sec)],
              ['Active Sessions', String(sessions.filter(s => s.expires_at > nowMs()).length)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm gap-4">
                <span className="text-muted-foreground shrink-0">{k}</span>
                <span className="text-right">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-border">
                {['IP Address', 'User Agent', 'Created', 'Last Seen', 'Expires', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map(s => {
                const expired = s.expires_at < nowMs()
                return (
                  <tr key={s.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.ip_address ?? '—'}</code></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate" title={s.user_agent ?? ''}>{s.user_agent ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(s.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(s.last_seen)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(s.expires_at)}</td>
                    <td className="px-4 py-3">
                      {/* Active/expired is determined client-side against Date.now() — no DB query needed */}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${expired ? 'bg-muted text-muted-foreground' : 'bg-green-500/20 text-green-400'}`}>
                        {expired ? 'Expired' : 'Active'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {sessions.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No sessions.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'watches' && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                {['Title', 'Type', 'S/E', 'Progress', 'Watch Time', 'Started', 'Done'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {watches.map(w => (
                <tr key={w.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    {w.series_title && <span className="text-muted-foreground">{w.series_title} · </span>}
                    <span className="font-medium">{w.item_title}</span>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{w.item_type}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {w.season_num != null ? `S${w.season_num}E${w.episode_num}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {w.progress_pct != null ? `${Math.round(w.progress_pct)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDur(w.watched_sec)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(w.started_at)}</td>
                  <td className="px-4 py-3 text-center">{w.completed ? '✓' : ''}</td>
                </tr>
              ))}
              {watches.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No watch history.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-border">
                {['Event', 'Details', 'IP', 'Location', 'When'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {auditLog.map(e => (
                <tr key={e.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{e.event_type}</code></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate" title={e.details ?? ''}>{e.details ?? '—'}</td>
                  <td className="px-4 py-3"><code className="text-xs">{e.ip_address ?? '—'}</code></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{[e.city, e.country].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(e.created_at)}</td>
                </tr>
              ))}
              {auditLog.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No audit events.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'logins' && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[400px]">
            <thead>
              <tr className="border-b border-border">
                {['IP Address', 'Result', 'When'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loginAttempts.map((a, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-4 py-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{a.ip_address}</code></td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {a.success ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(a.created_at)}</td>
                </tr>
              ))}
              {loginAttempts.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No login attempts recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
