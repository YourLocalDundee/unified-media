// Admin subtitle management — wraps the native subtitle system.
// "Scan Library" discovers media without subtitles and creates wanted entries.
// "Download Pending" triggers an OpenSubtitles lookup and writes .srt files to disk.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Trash2 } from 'lucide-react'

interface SubtitleWant {
  id: number
  media_item_id: string
  media_item_type: string
  title: string
  imdb_id: string | null
  media_path: string | null
  language: string
  forced: number
  hi: number
  status: string
  subtitle_file_id: number | null
  subtitle_path: string | null
  created_at: number
  updated_at: number
}

interface SeriesNumberingRow {
  id: string
  title: string
  tmdb_id: number | null
  subtitle_numbering: 'season' | 'absolute' | null
  skipped_count: number
  total_count: number
}

const STATUS_COLORS: Record<string, string> = {
  wanted: 'bg-yellow-600 text-white',
  downloaded: 'bg-green-600 text-white',
  skipped: 'bg-zinc-600 text-white',
  failed: 'bg-red-600 text-white',
}

const FILTERS = ['all', 'wanted', 'downloaded', 'skipped', 'failed']

function relTime(ms: number) {
  const d = Date.now() - ms
  if (d < 60000) return 'just now'
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

export default function AdminSubtitlesPage() {
  const [items, setItems] = useState<SubtitleWant[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [scanning, setScanning] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [dlResult, setDlResult] = useState<string | null>(null)
  const [recheckResult, setRecheckResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seriesNumbering, setSeriesNumbering] = useState<SeriesNumberingRow[]>([])
  const [numberingSaving, setNumberingSaving] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const qs = filter !== 'all' ? `?filter=${filter}` : ''
      const res = await fetch(`/api/subtitle${qs}`)
      if (res.ok) setItems(await res.json() as SubtitleWant[])
      else setError('Failed to load subtitles')
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }, [filter])

  const fetchSeriesNumbering = useCallback(async () => {
    try {
      const res = await fetch('/api/media/series/subtitle-numbering')
      if (res.ok) setSeriesNumbering(await res.json() as SeriesNumberingRow[])
    } catch { /* non-critical panel — leave list empty on failure */ }
  }, [])

  // Deferred a tick so fetchItems' loading setState runs outside the effect's
  // synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => { void fetchItems(); void fetchSeriesNumbering() }, 0)
    return () => clearTimeout(id)
  }, [fetchItems, fetchSeriesNumbering])

  async function setNumberingMode(seriesId: string, mode: 'season' | 'absolute' | null) {
    setNumberingSaving(seriesId)
    try {
      const res = await fetch(`/api/media/series/${seriesId}/subtitle-numbering`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (res.ok) void fetchSeriesNumbering()
      else setError('Failed to update numbering mode')
    } catch { setError('Network error') }
    finally { setNumberingSaving(null) }
  }

  const counts = {
    wanted: items.filter(i => i.status === 'wanted').length,
    downloaded: items.filter(i => i.status === 'downloaded').length,
    skipped: items.filter(i => i.status === 'skipped').length,
    failed: items.filter(i => i.status === 'failed').length,
  }

  async function scanLibrary() {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/subtitle/scan', { method: 'POST' })
      if (res.ok) {
        const d = await res.json() as { scanned: number; created: number; pruned: number }
        setScanResult(`Scanned ${d.scanned} items, ${d.created} new wanted, ${d.pruned} orphaned pruned`)
        void fetchItems()
        void fetchSeriesNumbering()
      } else setError('Scan failed')
    } catch { setError('Scan error') }
    finally { setScanning(false) }
  }

  async function recheckSkipped() {
    setRechecking(true)
    setRecheckResult(null)
    try {
      const res = await fetch('/api/subtitle/recheck', { method: 'POST' })
      if (res.ok) {
        const d = await res.json() as { reset: number }
        setRecheckResult(`${d.reset} skipped items reset to wanted — run "Download Pending" to re-search them`)
        void fetchItems()
      } else setError('Recheck failed')
    } catch { setError('Recheck error') }
    finally { setRechecking(false) }
  }

  async function downloadPending() {
    setDownloading(true)
    setDlResult(null)
    try {
      const res = await fetch('/api/subtitle/download', { method: 'POST' })
      if (!res.ok) { setError('Download failed'); setDownloading(false); return }
      const { jobId } = await res.json() as { jobId: string }

      // Poll until the background download job finishes (max 5 min).
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const statusRes = await fetch(`/api/jobs/${jobId}`)
        if (!statusRes.ok) break
        const job = await statusRes.json() as {
          status: string
          result?: { downloaded: number; skipped: number; failed: number; quotaExhausted?: boolean }
          error?: string
        }
        if (job.status === 'done') {
          const d = job.result
          setDlResult(
            d
              ? `${d.downloaded} downloaded, ${d.skipped} skipped, ${d.failed} failed` +
                  (d.quotaExhausted ? ' — daily quota exhausted, rest left for tomorrow' : '')
              : 'Done'
          )
          void fetchItems()
          void fetchSeriesNumbering()
          setDownloading(false)
          return
        }
        if (job.status === 'failed') { setError(job.error ?? 'Download failed'); break }
      }
    } catch { setError('Download error') }
    finally { setDownloading(false) }
  }

  async function skipItem(id: number) {
    await fetch(`/api/subtitle/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'skipped' }),
    })
    void fetchItems()
  }

  async function deleteItem(id: number) {
    if (!window.confirm('Delete this subtitle entry?')) return
    await fetch(`/api/subtitle/${id}`, { method: 'DELETE' })
    void fetchItems()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Subtitles</h1>
        <div className="flex gap-2">
          <button
            onClick={() => void scanLibrary()}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {scanning && <Loader2 className="w-4 h-4 animate-spin" />}
            Scan Library
          </button>
          <button
            onClick={() => void downloadPending()}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {downloading && <Loader2 className="w-4 h-4 animate-spin" />}
            Download Pending
          </button>
          <button
            onClick={() => void recheckSkipped()}
            disabled={rechecking}
            title="Reset 'skipped' items to 'wanted' so the next download pass re-searches them — OpenSubtitles' catalog grows over time. Also runs automatically every Sunday 2:30 AM."
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-700 text-white text-sm font-medium hover:bg-zinc-600 disabled:opacity-50"
          >
            {rechecking && <Loader2 className="w-4 h-4 animate-spin" />}
            Recheck Skipped
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-sm text-red-300 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
      {scanResult && (
        <div className="rounded-lg bg-green-900/30 border border-green-700 px-4 py-3 text-sm text-green-300 flex justify-between">
          {scanResult}
          <button onClick={() => setScanResult(null)} className="text-green-400 hover:text-green-200">✕</button>
        </div>
      )}
      {dlResult && (
        <div className="rounded-lg bg-blue-900/30 border border-blue-700 px-4 py-3 text-sm text-blue-300 flex justify-between">
          {dlResult}
          <button onClick={() => setDlResult(null)} className="text-blue-400 hover:text-blue-200">✕</button>
        </div>
      )}
      {recheckResult && (
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-600 px-4 py-3 text-sm text-zinc-300 flex justify-between">
          {recheckResult}
          <button onClick={() => setRecheckResult(null)} className="text-zinc-400 hover:text-zinc-200">✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Wanted', count: counts.wanted, color: 'text-yellow-400' },
          { label: 'Downloaded', count: counts.downloaded, color: 'text-green-400' },
          { label: 'Skipped', count: counts.skipped, color: 'text-zinc-400' },
          { label: 'Failed', count: counts.failed, color: 'text-red-400' },
        ].map(({ label, count, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
          </div>
        ))}
      </div>

      {/* Episode numbering — some long-running anime file "seasons" by story arc, which
          OpenSubtitles' own catalog doesn't follow (it uses a single season with absolute,
          cross-season episode numbers). Auto-detected per series on first search and cached
          here; override manually for shows the auto-probe hasn't reached or got wrong. */}
      {seriesNumbering.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Episode Numbering</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shows with skipped subtitles, or a numbering scheme already detected/overridden.
              &quot;Absolute&quot; means OpenSubtitles files this show under one season with
              flat episode numbers instead of our arc-based seasons.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Series</th>
                <th className="px-4 py-3 font-medium">Skipped</th>
                <th className="px-4 py-3 font-medium">Numbering</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {seriesNumbering.map(s => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{s.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.skipped_count} / {s.total_count}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={s.subtitle_numbering ?? 'auto'}
                      disabled={numberingSaving === s.id}
                      onChange={(e) => {
                        const v = e.target.value
                        void setNumberingMode(s.id, v === 'auto' ? null : (v as 'season' | 'absolute'))
                      }}
                      className="text-xs px-2 py-1 rounded bg-muted border border-border text-foreground disabled:opacity-50"
                    >
                      <option value="auto">Auto{s.subtitle_numbering ? '' : ' (undetermined)'}</option>
                      <option value="season">Season-based</option>
                      <option value="absolute">Absolute</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              filter === f
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center p-12 text-muted-foreground text-sm">
            No subtitle entries found. Run &quot;Scan Library&quot; to populate.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Lang</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">IMDB</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Subtitle File</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground max-w-xs truncate" title={item.title}>
                    {item.title}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-900/40 text-blue-300 font-mono">
                      {item.language}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.media_item_type}</td>
                  <td className="px-4 py-3">
                    {/* Guard against blank/malformed IMDB IDs before constructing the URL */}
                    {item.imdb_id && /\d/.test(item.imdb_id) ? (
                      <a
                        href={`https://www.imdb.com/title/tt${item.imdb_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline font-mono text-xs"
                      >
                        tt{item.imdb_id}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[item.status] ?? 'bg-zinc-700 text-white'}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate" title={item.subtitle_path ?? undefined}>
                    {item.subtitle_path ? item.subtitle_path.split('/').pop() : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{relTime(item.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {item.status === 'wanted' && (
                        <button
                          onClick={() => void skipItem(item.id)}
                          className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                        >
                          Skip
                        </button>
                      )}
                      <button
                        onClick={() => void deleteItem(item.id)}
                        className="text-red-400 hover:text-red-300"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
