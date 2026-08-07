/**
 * Admin Request Bridge Page (/admin/automation/bridge)
 *
 * Shows all monitored items that were created via the request approval bridge —
 * items that have a tmdb_id, meaning they came from an approved media request
 * rather than being manually added through the main automation page.
 *
 * Two actions are available:
 *   - "Check Availability Now" — triggers a manual availability sync (POST /api/automation/sync)
 *     which polls media_items and advances grabbed → imported for any finished downloads
 *   - Refresh button — re-fetches the bridged items list
 *
 * The stats row (Total / Wanted / Grabbed / Imported) gives a quick pipeline health snapshot.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

interface BridgedItem {
  id: number
  tmdb_id: number
  tvdb_id: number | null
  type: 'movie' | 'tv'
  title: string
  year: number | null
  status: 'wanted' | 'grabbed' | 'imported' | 'ignored'
  quality_profile_id: number
  created_at: number
  updated_at: number
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// Static map avoids constructing Tailwind class strings dynamically (which get purged)
const STATUS_BADGE: Record<BridgedItem['status'], string> = {
  wanted: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  grabbed: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  imported: 'bg-green-500/20 text-green-400 border border-green-500/30',
  ignored: 'bg-muted text-muted-foreground border border-border',
}

export default function BridgePage() {
  const [items, setItems] = useState<BridgedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/automation/bridge')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setItems(await res.json() as BridgedItem[])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred a tick so the loading setState in fetchItems runs outside the effect's
  // synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => void fetchItems(), 0)
    return () => clearTimeout(id)
  }, [fetchItems])

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/automation/sync', { method: 'POST' })
      const data = await res.json() as { updated?: number; error?: string }
      if (!res.ok) {
        setSyncResult(`Error: ${data.error ?? 'Unknown error'}`)
      } else {
        const count = data.updated ?? 0
        // Human-readable result stays visible in the header until the next sync
        setSyncResult(count > 0 ? `${count} item${count === 1 ? '' : 's'} updated` : 'Nothing new found')
      }
      // Refresh the table so updated statuses (grabbed → imported) are reflected immediately
      void fetchItems()
    } catch (err) {
      setSyncResult(`Error: ${String(err)}`)
    } finally {
      setSyncing(false)
    }
  }

  // Derived stats computed client-side from the already-loaded items list
  const total = items.length
  const wanted = items.filter(i => i.status === 'wanted').length
  const grabbed = items.filter(i => i.status === 'grabbed').length
  const imported = items.filter(i => i.status === 'imported').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">Request Bridge</h1>
        <div className="flex items-center gap-2">
          {syncResult && (
            <span className="text-sm text-muted-foreground">{syncResult}</span>
          )}
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
            Check Availability Now
          </button>
          <button
            onClick={() => void fetchItems()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: total, color: 'text-foreground' },
          { label: 'Wanted', value: wanted, color: 'text-yellow-400' },
          { label: 'Grabbed', value: grabbed, color: 'text-blue-400' },
          { label: 'Imported', value: imported, color: 'text-green-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <section>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Title', 'Type', 'TMDB', 'Status', 'Year', 'Updated'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-muted-foreground font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{item.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.type === 'movie'
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      }`}>
                        {item.type === 'movie' ? 'Movie' : 'TV'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {/* Link to TMDB so admins can quickly verify the correct item was matched */}
                      <a
                        href={`https://www.themoviedb.org/${item.type === 'tv' ? 'tv' : 'movie'}/${item.tmdb_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary hover:underline"
                      >
                        {item.tmdb_id}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[item.status]}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.year ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{relativeTime(item.updated_at)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No bridged items yet. Approve a request to queue it here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
