// Admin user management table — server-paginated list with search, role, and status
// filters. Supports bulk suspend/activate and per-row actions (reset password, delete).
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Search } from 'lucide-react'

interface User {
  id: string; username: string; email: string | null; role: string;
  is_active: number; created_at: number; last_login: number | null; watch_count: number
}

interface UsersResponse { users: User[]; total: number; page: number; pages: number }

function formatDate(ts: number | null): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleDateString()
}

export default function AdminUsersPage() {
  const [data, setData] = useState<UsersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{ userId: string; tempPw: string } | null>(null)

  // Wrapped in useCallback so the effect dependency array stays stable between renders.
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ page: String(page), search, role: roleFilter, status: statusFilter })
      const res = await fetch(`/api/admin/users?${qs}`)
      if (res.ok) setData(await res.json() as UsersResponse)
    } finally {
      setLoading(false)
    }
  }, [page, search, roleFilter, statusFilter])

  useEffect(() => { void fetchUsers() }, [fetchUsers])

  async function doAction(userId: string, action: 'suspend' | 'activate' | 'reset-password') {
    setActionLoading(`${action}:${userId}`)
    try {
      const res = await fetch(`/api/admin/users/${userId}/${action}`, { method: 'POST' })
      if (res.ok) {
        if (action === 'reset-password') {
          const d = await res.json() as { tempPassword: string }
          setResetResult({ userId, tempPw: d.tempPassword })
        }
        void fetchUsers()
      }
    } finally {
      setActionLoading(null)
    }
  }

  async function deleteUser(userId: string) {
    if (!window.confirm('Delete this user permanently? This cannot be undone.')) return
    setActionLoading(`delete:${userId}`)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      if (res.ok) void fetchUsers()
    } finally {
      setActionLoading(null)
    }
  }

  // Bulk actions are serial on purpose — avoids flooding the API and keeps audit
  // log entries individually identifiable per user.
  async function bulkAction(action: 'suspend' | 'activate') {
    for (const id of selected) await doAction(id, action)
    setSelected(new Set())
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Users</h1>

      {/* Reset password modal */}
      {resetResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl border border-border bg-card p-6 max-w-sm w-full">
            <h2 className="text-lg font-semibold mb-2">Temporary Password</h2>
            <p className="text-sm text-muted-foreground mb-3">Share this with the user. It will only be shown once.</p>
            <code className="block rounded-lg bg-muted px-4 py-2 text-sm font-mono break-all">{resetResult.tempPw}</code>
            <button onClick={() => setResetResult(null)} className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search" placeholder="Search username or email…"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="rounded-lg border border-border bg-card pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
          />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none">
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {selected.size > 0 && (
          <div className="flex gap-2 ml-auto">
            <button onClick={() => void bulkAction('suspend')}
              className="rounded-lg bg-yellow-500/20 text-yellow-400 px-3 py-2 text-sm hover:bg-yellow-500/30">
              Suspend {selected.size}
            </button>
            <button onClick={() => void bulkAction('activate')}
              className="rounded-lg bg-green-500/20 text-green-400 px-3 py-2 text-sm hover:bg-green-500/30">
              Activate {selected.size}
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left">
                  <input type="checkbox" onChange={e => {
                    if (e.target.checked) setSelected(new Set(data?.users.map(u => u.id) ?? []))
                    else setSelected(new Set())
                  }} />
                </th>
                {['Username', 'Email', 'Role', 'Status', 'Joined', 'Last Login', 'Watches', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.users.map(user => (
                <tr key={user.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(user.id)}
                      onChange={e => {
                        const s = new Set(selected)
                        if (e.target.checked) s.add(user.id)
                        else s.delete(user.id)
                        setSelected(s)
                      }} />
                  </td>
                  <td className="px-4 py-3 font-medium">{user.username}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.role === 'admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-muted text-muted-foreground'}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {user.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(user.last_login)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.watch_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => void doAction(user.id, user.is_active ? 'suspend' : 'activate')}
                        disabled={actionLoading !== null}
                        className="rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80"
                      >
                        {user.is_active ? 'Suspend' : 'Activate'}
                      </button>
                      <button
                        onClick={() => void doAction(user.id, 'reset-password')}
                        disabled={actionLoading !== null}
                        className="rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80"
                      >
                        Reset PW
                      </button>
                      <button
                        onClick={() => void deleteUser(user.id)}
                        disabled={actionLoading !== null || user.role === 'admin'}
                        className="rounded px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex justify-center gap-1">
          {Array.from({ length: data.pages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`rounded px-3 py-1 text-sm ${p === page ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/80'}`}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
