// Admin server status page — polls the server-status API every 15 seconds to show
// live Node.js process stats, SQLite DB row counts, and external service health.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'

interface ServerStatus {
  db: { size: number; users: number; sessions: number; watches: number; auditEntries: number }
  qbit: { ok: boolean; version: string | null }
  app: { nodeVersion: string; uptimeMs: number; memoryMb: number }
  media?: { ok: boolean; root: string | null }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ')
}

export default function AdminServerPage() {
  const [data, setData] = useState<ServerStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/server-status')
      if (res.ok) { setData(await res.json() as ServerStatus); setLastChecked(new Date()) }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void refresh()
    // 15s polling keeps the page fresh without hammering the API.
    // clearInterval on unmount prevents stale callbacks after navigation.
    const iv = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(iv)
  }, [refresh])

  const services = data ? [
    { name: 'Unified Media Torrent (UMT)', ok: data.qbit.ok, version: data.qbit.version },
    ...(data.media ? [{ name: `Media Root${data.media.root ? ` (${data.media.root})` : ''}`, ok: data.media.ok, version: null }] : []),
  ] : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Server Status</h1>
        <div className="flex items-center gap-3">
          {lastChecked && <span className="text-xs text-muted-foreground">Last checked: {lastChecked.toLocaleTimeString()}</span>}
          <button onClick={() => void refresh()} className="rounded-lg bg-muted px-3 py-1.5 text-sm hover:bg-muted/80">
            Refresh
          </button>
        </div>
      </div>

      {loading && !data ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : data && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* App */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <h2 className="font-semibold">Unified Media App</h2>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Node</dt><dd>{data.app.nodeVersion}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Uptime</dt><dd>{formatUptime(data.app.uptimeMs)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Memory</dt><dd>{data.app.memoryMb} MB</dd></div>
            </dl>
          </div>

          {/* DB */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              <h2 className="font-semibold">SQLite Database</h2>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Size</dt><dd>{(data.db.size / 1024).toFixed(1)} KB</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Users</dt><dd>{data.db.users}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Sessions</dt><dd>{data.db.sessions}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Watch Events</dt><dd>{data.db.watches}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Audit Entries</dt><dd>{data.db.auditEntries}</dd></div>
            </dl>
          </div>

          {/* External services */}
          {services.map(s => (
            <div key={s.name} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={`h-2 w-2 rounded-full ${s.ok ? 'bg-green-500' : 'bg-red-500'}`}></span>
                <h2 className="font-semibold">{s.name}</h2>
                <span className="ml-auto text-xs text-muted-foreground">{s.ok ? 'Online' : 'Offline'}</span>
              </div>
              {s.version && <p className="text-sm text-muted-foreground">Version: {s.version}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
