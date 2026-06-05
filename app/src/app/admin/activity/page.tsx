// Admin watch activity page — server-paginated log of every watch_events row
// across all users. Includes a one-click CSV export of the full untruncated dataset.
'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

interface WatchEvent {
  id: number; username: string; item_title: string; series_title: string | null;
  item_type: string; season_num: number | null; episode_num: number | null;
  progress_pct: number | null; watched_sec: number | null; started_at: number; completed: number
}

interface ActivityResponse { events: WatchEvent[]; total: number; page: number; pages: number }

export default function AdminActivityPage() {
  const [data, setData] = useState<ActivityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/activity?page=${page}`)
      .then(r => r.json())
      .then(d => setData(d as ActivityResponse))
      .finally(() => setLoading(false))
  }, [page])

  async function exportCsv() {
    const res = await fetch('/api/admin/activity/export')
    const blob = await res.blob()
    // Programmatic anchor click triggers the browser's native file save dialog.
    // URL.revokeObjectURL frees the Blob memory after the click fires.
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'watch-activity.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Watch Activity</h1>
        <button onClick={() => void exportCsv()}
          className="rounded-lg bg-muted px-4 py-2 text-sm hover:bg-muted/80">
          Export CSV
        </button>
      </div>

      {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                {['User', 'Title', 'Type', 'S/E', 'Progress', 'Watched', 'Started', 'Done'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.events.map(ev => (
                <tr key={ev.id}>
                  <td className="px-4 py-2 font-medium">{ev.username}</td>
                  <td className="px-4 py-2 max-w-[200px] truncate">
                    {ev.series_title ? <><span className="text-muted-foreground">{ev.series_title} · </span>{ev.item_title}</> : ev.item_title}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground capitalize">{ev.item_type}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {ev.season_num != null && ev.episode_num != null ? `S${ev.season_num}E${ev.episode_num}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {ev.progress_pct != null ? `${Math.round(ev.progress_pct)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {ev.watched_sec != null ? `${Math.round(ev.watched_sec / 60)}m` : '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(ev.started_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{ev.completed ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
