// Manual indexer search — a debug tool (prowlarr-analysis.md #8), not a library-import flow.
// Fans out an arbitrary query across every enabled indexer via the existing /api/torznab/search
// route and lists raw results. "Grab" posts the release straight to qBittorrent
// (/api/qbit/torrents/add) — it deliberately bypasses monitored_items/quality profiles/gates,
// since the point is answering "does this tracker return results for X", not managing a library.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Search, Download, ArrowLeft } from 'lucide-react'
import { NEWZNAB_STANDARD_CATEGORIES } from '@/lib/indexer/categories'

interface TorznabResult {
  title: string
  infoHash: string
  magnetUrl: string
  downloadUrl: string
  size: number
  seeders: number
  leechers: number
  indexerName: string
  publishDate: string
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export default function ManualSearchPage() {
  const [q, setQ] = useState('')
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<TorznabResult[] | null>(null)
  const [grabbing, setGrabbing] = useState<Set<string>>(new Set())
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set())

  function toggleCat(id: string) {
    setCats(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const sp = new URLSearchParams({ q: q.trim() })
      if (cats.size > 0) sp.set('cats', [...cats].join(','))
      const res = await fetch(`/api/torznab/search?${sp.toString()}`)
      if (!res.ok) throw new Error(`Search failed (${res.status})`)
      const data = await res.json()
      setResults(data.results as TorznabResult[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleGrab(result: TorznabResult) {
    const url = result.magnetUrl || result.downloadUrl
    if (!url) return
    const key = result.infoHash || url
    setGrabbing(prev => new Set(prev).add(key))
    setError(null)
    try {
      const res = await fetch('/api/qbit/torrents/add', {
        method: 'POST',
        body: new URLSearchParams({ urls: url }),
      })
      if (!res.ok) throw new Error(`Add failed (${res.status})`)
      setGrabbed(prev => new Set(prev).add(key))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGrabbing(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/indexers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Indexers
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Manual Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Debug tool — searches every enabled indexer directly. Grab bypasses quality profiles and
          gates and adds the raw release straight to qBittorrent.
        </p>
      </div>

      <form onSubmit={e => void handleSearch(e)} className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Query</label>
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="e.g. The Movie 2024"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Categories (optional — leave empty for all)</label>
          <div className="flex flex-wrap gap-2">
            {NEWZNAB_STANDARD_CATEGORIES.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCat(c.id)}
                className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${
                  cats.has(c.id)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={loading || !q.trim()}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? 'Searching…' : 'Search'}
        </button>
        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</p>}
      </form>

      {results !== null && (
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border text-sm text-muted-foreground">
            {results.length} result{results.length === 1 ? '' : 's'}
          </div>
          {results.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No results.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Indexer</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">S/L</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {results.map(r => {
                  const key = r.infoHash || r.magnetUrl || r.downloadUrl
                  const canGrab = Boolean(r.magnetUrl || r.downloadUrl)
                  return (
                    <tr key={key} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-foreground max-w-md truncate" title={r.title}>{r.title}</td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{r.indexerName}</td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{formatBytes(r.size)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="text-green-500">{r.seeders}</span>
                        {' / '}
                        <span className="text-muted-foreground">{r.leechers}</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => void handleGrab(r)}
                          disabled={!canGrab || grabbing.has(key) || grabbed.has(key)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          {grabbing.has(key) ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                          {grabbed.has(key) ? 'Grabbed' : grabbing.has(key) ? 'Grabbing…' : 'Grab'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
