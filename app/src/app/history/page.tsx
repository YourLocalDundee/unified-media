'use client'

import { useState, useEffect } from 'react'
import { Loader2, Film, Tv, CheckCircle2, Clock } from 'lucide-react'

interface WatchEvent {
  id: number; item_id: string; item_title: string; series_title: string | null
  item_type: string; season_num: number | null; episode_num: number | null
  progress_pct: number | null; watched_sec: number | null; duration_sec: number | null
  completed: number; started_at: number; ended_at: number | null
}

interface HistoryResponse { events: WatchEvent[]; total: number; page: number; pages: number }

function fmtDate(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDuration(sec: number | null) {
  if (!sec) return null
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function HistoryPage() {
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'movies' | 'episodes' | 'completed'>('all')

  useEffect(() => {
    setLoading(true)
    const qs = new URLSearchParams({ page: String(page), filter })
    fetch(`/api/auth/history?${qs}`)
      .then(r => r.json())
      .then(d => setData(d as HistoryResponse))
      .finally(() => setLoading(false))
  }, [page, filter])

  const totalWatchTime = data?.events.reduce((s, e) => s + (e.watched_sec ?? 0), 0) ?? 0

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Watch History</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              {data.total} item{data.total !== 1 ? 's' : ''} · {fmtDuration(totalWatchTime) ?? '0m'} watched this page
            </p>
          )}
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(['all', 'movies', 'episodes', 'completed'] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(1) }}
              className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data?.events.length ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <Clock className="h-10 w-10 opacity-30" />
          <p className="text-sm">No watch history yet. Start watching something!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.events.map(ev => (
            <div key={ev.id} className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted/20 transition-colors">
              <div className="flex-shrink-0 text-muted-foreground">
                {ev.item_type === 'episode' ? <Tv className="h-4 w-4" /> : <Film className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">
                    {ev.series_title ? (
                      <><span className="text-muted-foreground">{ev.series_title}</span> · {ev.item_title}</>
                    ) : ev.item_title}
                  </span>
                  {ev.season_num != null && ev.episode_num != null && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      S{ev.season_num}E{ev.episode_num}
                    </span>
                  )}
                  {ev.completed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                  ) : ev.progress_pct != null ? (
                    <span className="text-xs text-muted-foreground">{Math.round(ev.progress_pct)}%</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  <span>{fmtDate(ev.started_at)}</span>
                  {fmtDuration(ev.watched_sec) && <span>{fmtDuration(ev.watched_sec)} watched</span>}
                </div>
              </div>
              {ev.progress_pct != null && !ev.completed && (
                <div className="flex-shrink-0 w-16">
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.round(ev.progress_pct)}%` }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex justify-center gap-1">
          {Array.from({ length: data.pages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)}
              className={`rounded px-3 py-1 text-sm ${p === page ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
