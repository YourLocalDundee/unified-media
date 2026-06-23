'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Film, Tv, Clapperboard, ScanLine, CheckCircle, AlertCircle } from 'lucide-react'

interface Stats {
  movies: number
  series: number
  episodes: number
}

interface ScanResult {
  scanned: number
  enriched: number
  failed: number
}

interface JobResponse {
  id: string
  status: string
  result?: ScanResult
  error?: string
}

const ENV_VARS = [
  {
    name: 'MEDIA_ROOTS',
    description: 'Comma-separated absolute paths to media directories (e.g. /media/movies,/media/tv)',
    required: true,
  },
  {
    name: 'TMDB_ACCESS_TOKEN',
    description: 'TMDB API read access token — used for metadata enrichment (poster, overview, IDs)',
    required: true,
  },
  {
    name: 'TRANSCODE_CACHE',
    description: 'Directory for HLS transcode segments (default: /tmp/transcode)',
    required: false,
  },
]

export default function MediaServerPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanError, setScanError] = useState('')

  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await fetch('/api/media/stats')
      if (res.ok) setStats(await res.json() as Stats)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  // Deferred a tick so fetchStats' loading setState runs outside the effect's
  // synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => void fetchStats(), 0)
    return () => clearTimeout(id)
  }, [fetchStats])

  async function runScan() {
    setScanning(true)
    setScanResult(null)
    setScanError('')
    try {
      const res = await fetch('/api/media/scan', { method: 'POST' })
      if (!res.ok) {
        setScanError('Scan failed — check server logs for details.')
        setScanning(false)
        return
      }
      const { jobId } = await res.json() as { jobId: string }

      // Poll until the background scan job finishes (max 5 min).
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const statusRes = await fetch(`/api/jobs/${jobId}`)
        if (!statusRes.ok) break
        const job = await statusRes.json() as JobResponse
        if (job.status === 'done') {
          if (job.result) setScanResult(job.result)
          void fetchStats()
          setScanning(false)
          return
        }
        if (job.status === 'failed') {
          setScanError(job.error ?? 'Scan failed — check server logs for details.')
          setScanning(false)
          return
        }
      }
      setScanError('Scan timed out — check server logs for details.')
    } catch {
      setScanError('Network error while triggering scan.')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">Media Server</h1>
        <button
          onClick={() => void runScan()}
          disabled={scanning}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ScanLine className="h-4 w-4" />
          )}
          {scanning ? 'Scanning…' : 'Scan & Enrich'}
        </button>
      </div>

      {/* Scan result banner */}
      {scanResult && (
        <div className="flex items-start gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-400">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Scan complete — <strong>{scanResult.scanned}</strong> files scanned,{' '}
            <strong>{scanResult.enriched}</strong> enriched,{' '}
            <strong>{scanResult.failed}</strong> failed.
          </span>
        </div>
      )}
      {scanError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{scanError}</span>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Film className="h-5 w-5" />}
          label="Movies"
          value={statsLoading ? null : (stats?.movies ?? 0)}
        />
        <StatCard
          icon={<Tv className="h-5 w-5" />}
          label="Series"
          value={statsLoading ? null : (stats?.series ?? 0)}
        />
        <StatCard
          icon={<Clapperboard className="h-5 w-5" />}
          label="Episodes"
          value={statsLoading ? null : (stats?.episodes ?? 0)}
        />
      </div>

      {/* Environment status */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Environment Configuration</h2>
        <p className="text-sm text-muted-foreground">
          These environment variables must be set in the container for full functionality. Missing
          variables fall back to safe defaults where possible.
        </p>
        <div className="space-y-3">
          {ENV_VARS.map(v => (
            <div
              key={v.name}
              className="flex items-start gap-3 rounded-lg border border-border bg-background p-4"
            >
              <div className="mt-0.5 shrink-0">
                {v.required ? (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    required
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-muted text-muted-foreground border border-border">
                    optional
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <code className="text-sm font-mono text-primary">{v.name}</code>
                <p className="mt-0.5 text-xs text-muted-foreground">{v.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Development note */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">About Phase 5</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Phase 5 is in active development. The built-in media server runs alongside Jellyfin
          — configure <code className="font-mono text-primary">MEDIA_ROOTS</code> to point to
          the same directories Jellyfin monitors. Direct-play streaming is handled via the{' '}
          <code className="font-mono text-primary">/api/media/stream/[id]</code> route with full
          range-request support. HLS transcoding requires <code className="font-mono text-primary">
          ffmpeg</code> available in the container. Metadata enrichment uses TMDB at 250 ms/request
          to stay within rate limits.
        </p>
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
        {value === null ? (
          <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <p className="text-2xl font-bold text-foreground tabular-nums">{value.toLocaleString()}</p>
        )}
      </div>
    </div>
  )
}
