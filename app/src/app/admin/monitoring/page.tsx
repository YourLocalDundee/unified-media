'use client'

import { useState, useEffect } from 'react'
import { Loader2, Search, Eye, Shield, User, MapPin, Wifi } from 'lucide-react'
import Link from 'next/link'

interface UserMonitor {
  id: string; username: string; email: string | null; role: string; is_active: number
  first_name: string | null; last_name: string | null; location: string | null
  created_at: number; last_login: number | null; last_watch: number | null
  last_watch_title: string | null; last_ip: string | null; last_country: string | null
  watch_count: number; active_sessions: number
}

function formatDate(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function MonitoringPage() {
  const [users, setUsers] = useState<UserMonitor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'suspended'>('all')

  useEffect(() => {
    setLoading(true)
    fetch('/api/admin/monitoring')
      .then(r => r.json())
      .then((d: { users: UserMonitor[] }) => setUsers(d.users))
      .finally(() => setLoading(false))
  }, [])

  const filtered = users.filter(u => {
    if (filter === 'active' && !u.is_active) return false
    if (filter === 'suspended' && u.is_active) return false
    if (search) {
      const q = search.toLowerCase()
      return u.username.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.last_ip ?? '').includes(q) ||
        (u.first_name ?? '').toLowerCase().includes(q) ||
        (u.last_name ?? '').toLowerCase().includes(q)
    }
    return true
  })

  const totalWatches = users.reduce((s, u) => s + u.watch_count, 0)
  const activeSessions = users.reduce((s, u) => s + u.active_sessions, 0)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">User Monitoring</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: users.length, icon: User },
          { label: 'Active Now', value: activeSessions, icon: Wifi },
          { label: 'Total Watches', value: totalWatches, icon: Eye },
          { label: 'Suspended', value: users.filter(u => !u.is_active).length, icon: Shield },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="search" placeholder="Search username, email, IP…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="rounded-lg border border-border bg-card pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64" />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['all', 'active', 'suspended'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
              {f}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border">
                {['User', 'Status', 'Last IP / Location', 'Sessions', 'Last Watch', 'Watches', 'Last Login', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium">{u.username}</span>
                      {(u.first_name || u.last_name) && (
                        <span className="text-muted-foreground ml-1 text-xs">{[u.first_name, u.last_name].filter(Boolean).join(' ')}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{u.email ?? '—'}</div>
                    {u.location && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <MapPin className="h-3 w-3" />{u.location}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${u.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {u.is_active ? 'Active' : 'Suspended'}
                      </span>
                      {u.role === 'admin' && (
                        <span className="inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-400">Admin</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.last_ip ? (
                      <div>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{u.last_ip}</code>
                        {u.last_country && <div className="text-xs text-muted-foreground mt-0.5">{u.last_country}</div>}
                      </div>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-medium ${u.active_sessions > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
                      {u.active_sessions}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.last_watch_title ? (
                      <div>
                        <span className="text-xs truncate max-w-[160px] block">{u.last_watch_title}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(u.last_watch)}</span>
                      </div>
                    ) : <span className="text-muted-foreground text-xs">Never</span>}
                  </td>
                  <td className="px-4 py-3 text-center font-medium">{u.watch_count}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(u.last_login)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.id}`}
                      className="rounded px-2 py-1 text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                      View Detail
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
