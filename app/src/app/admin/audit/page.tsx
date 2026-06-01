'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface AuditEntry {
  id: number; username: string | null; event_type: string; ip_address: string | null;
  country: string | null; details: string | null; created_at: number
}

interface AuditResponse { entries: AuditEntry[]; total: number; page: number; pages: number }

export default function AdminAuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/audit?page=${page}`)
      .then(r => r.json())
      .then(d => setData(d as AuditResponse))
      .finally(() => setLoading(false))
  }, [page])

  function toggleExpand(id: number) {
    const s = new Set(expanded)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setExpanded(s)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>

      {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Timestamp', 'Username', 'Event', 'IP', 'Country', 'Details'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.entries.map(entry => (
                <>
                  <tr key={entry.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => toggleExpand(entry.id)}>
                    <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-medium">{entry.username ?? '—'}</td>
                    <td className="px-4 py-2 capitalize text-muted-foreground">{entry.event_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{entry.ip_address ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{entry.country ?? '—'}</td>
                    <td className="px-4 py-2">
                      {entry.details && entry.details !== '{}' && (
                        expanded.has(entry.id)
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                  </tr>
                  {expanded.has(entry.id) && entry.details && (
                    <tr key={`${entry.id}-detail`} className="bg-muted/10">
                      <td colSpan={6} className="px-4 py-2">
                        <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                          {JSON.stringify(JSON.parse(entry.details), null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex justify-center gap-1">
          {Array.from({ length: Math.min(data.pages, 10) }, (_, i) => i + 1).map(p => (
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
