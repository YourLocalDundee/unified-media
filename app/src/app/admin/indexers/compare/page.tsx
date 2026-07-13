// Native-vs-Prowlarr head-to-head — cutover evidence for the indexer independence build. Runs a
// query against two chosen indexers independently (no merge/dedup, unlike /admin/indexers/search)
// so a native adapter's real standalone contribution is visible instead of being masked by
// searchAllIndexers' infoHash dedup (which silently keeps whichever side has more seeders).
'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Loader2, ArrowLeft, GitCompare } from 'lucide-react'
import { nowMs } from '@/lib/utils'

interface Indexer {
  id: number
  name: string
  search_type: string
  enabled: number
  health_status: string | null
  disabled_until: number | null
}

interface CompareSideResult {
  indexerId: number
  indexerName: string
  searchType: string
  status: 'ok' | 'error'
  responseTimeMs: number
  errorMessage?: string
  resultCount: number
  sample: Array<{ title: string; seeders: number; leechers: number; size: number; hasHash: boolean }>
}

interface CompareResult {
  a: CompareSideResult
  b: CompareSideResult
  hashOverlapCount: number | null
}

function relativeTime(ms: number): string {
  const diff = nowMs() - ms
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
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

// Prowlarr's own bridged name (e.g. "Nyaa.si") doesn't always match our catalog name for the same
// tracker (e.g. "Nyaa") exactly — case-insensitive contains-either-way covers the mismatches seen
// in practice (Nyaa/Nyaa.si) while still matching exactly for the rest.
function suggestProwlarrTwin(native: Indexer, all: Indexer[]): Indexer | null {
  const nativeName = native.name.toLowerCase()
  const candidates = all.filter(i => i.id !== native.id && i.name.startsWith('Prowlarr: '))
  for (const c of candidates) {
    const suffix = c.name.slice('Prowlarr: '.length).toLowerCase()
    if (suffix.includes(nativeName) || nativeName.includes(suffix)) return c
  }
  return null
}

function IndexerHealthTag({ indexer }: { indexer: Indexer }) {
  const inBackoff = indexer.disabled_until !== null && indexer.disabled_until > nowMs()
  if (inBackoff) {
    return <span className="text-xs text-yellow-400">in backoff until {relativeTime(indexer.disabled_until as number)}</span>
  }
  if (indexer.health_status === 'ok') return <span className="text-xs text-green-500">ok</span>
  if (indexer.health_status === 'error') return <span className="text-xs text-red-400">error</span>
  return <span className="text-xs text-muted-foreground">unknown</span>
}

function ResultCard({ side, label }: { side: CompareSideResult; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold text-foreground truncate" title={side.indexerName}>{side.indexerName}</h3>
        <span className="shrink-0 rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{side.searchType}</p>

      {side.status === 'ok' ? (
        <p className="text-sm mb-3">
          <span className="text-green-500 font-medium">{side.resultCount} result{side.resultCount === 1 ? '' : 's'}</span>
          <span className="text-muted-foreground"> in {side.responseTimeMs}ms</span>
        </p>
      ) : (
        <p className="text-sm text-red-400 bg-red-500/10 rounded px-3 py-2 mb-3">
          Error after {side.responseTimeMs}ms: {side.errorMessage}
        </p>
      )}

      {side.sample.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-1 font-medium">Title</th>
              <th className="py-1 font-medium">Size</th>
              <th className="py-1 font-medium">S/L</th>
              <th className="py-1 font-medium">Hash</th>
            </tr>
          </thead>
          <tbody>
            {side.sample.map((r, idx) => (
              <tr key={idx} className="border-b border-border last:border-0">
                <td className="py-1 pr-2 text-foreground max-w-[16rem] truncate" title={r.title}>{r.title}</td>
                <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{formatBytes(r.size)}</td>
                <td className="py-1 pr-2 whitespace-nowrap">
                  <span className="text-green-500">{r.seeders}</span>
                  {' / '}
                  <span className="text-muted-foreground">{r.leechers}</span>
                </td>
                <td className="py-1 text-muted-foreground">{r.hasHash ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function CompareIndexersPage() {
  const [indexers, setIndexers] = useState<Indexer[]>([])
  const [loadingIndexers, setLoadingIndexers] = useState(true)
  const [idA, setIdA] = useState<number | ''>('')
  const [idB, setIdB] = useState<number | ''>('')
  const [q, setQ] = useState('')
  const [imdbid, setImdbid] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [autoSuggested, setAutoSuggested] = useState(false)

  useEffect(() => {
    fetch('/api/indexer')
      .then(res => res.json())
      .then((data: Indexer[]) => setIndexers(data.sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setError('Failed to load indexers'))
      .finally(() => setLoadingIndexers(false))
  }, [])

  const indexerA = useMemo(() => indexers.find(i => i.id === idA) ?? null, [indexers, idA])

  function handlePickA(value: string) {
    const id = value === '' ? '' : Number(value)
    setIdA(id)
    setResult(null)
    if (id === '') return
    const native = indexers.find(i => i.id === id)
    if (!native) return
    const suggestion = suggestProwlarrTwin(native, indexers)
    if (suggestion) {
      setIdB(suggestion.id)
      setAutoSuggested(true)
    } else {
      setIdB('')
      setAutoSuggested(false)
    }
  }

  function handlePickB(value: string) {
    setIdB(value === '' ? '' : Number(value))
    setAutoSuggested(false)
    setResult(null)
  }

  async function handleCompare(e: React.FormEvent) {
    e.preventDefault()
    if (idA === '' || idB === '' || (!q.trim() && !imdbid.trim())) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/indexers/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indexerAId: idA,
          indexerBId: idB,
          q: q.trim() || undefined,
          imdbid: imdbid.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Compare failed (${res.status})`)
      }
      setResult(await res.json() as CompareResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
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
        <h1 className="text-2xl font-bold text-foreground">Compare vs Prowlarr</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Runs the same query against two indexers independently — no merge, no dedup — so a native
          adapter&apos;s standalone results are visible instead of being masked by whichever side the
          live search fan-out keeps. Neither side&apos;s health/backoff/quota is affected.
        </p>
      </div>

      <form onSubmit={e => void handleCompare(e)} className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Indexer A</label>
            <select
              value={idA}
              onChange={e => handlePickA(e.target.value)}
              disabled={loadingIndexers}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select…</option>
              {indexers.map(i => (
                <option key={i.id} value={i.id}>{i.name} ({i.search_type})</option>
              ))}
            </select>
            {indexerA && <div className="mt-1"><IndexerHealthTag indexer={indexerA} /></div>}
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Indexer B{autoSuggested && idB !== '' && <span className="text-primary"> (suggested)</span>}
            </label>
            <select
              value={idB}
              onChange={e => handlePickB(e.target.value)}
              disabled={loadingIndexers}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select…</option>
              {indexers.map(i => (
                <option key={i.id} value={i.id}>{i.name} ({i.search_type})</option>
              ))}
            </select>
            {idA !== '' && idB === '' && !loadingIndexers && (
              <p className="mt-1 text-xs text-muted-foreground">No Prowlarr row found for this tracker — pick one manually if you want a comparison anyway.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <label className="block text-xs text-muted-foreground mb-1">IMDb ID (optional — for eztv-shaped indexers)</label>
            <input
              type="text"
              value={imdbid}
              onChange={e => setImdbid(e.target.value)}
              placeholder="e.g. tt0111161"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={running || idA === '' || idB === '' || (!q.trim() && !imdbid.trim())}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
          {running ? 'Comparing…' : 'Compare'}
        </button>
        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</p>}
      </form>

      {result && (
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-4">
            <ResultCard side={result.a} label="A" />
            <ResultCard side={result.b} label="B" />
          </div>
          <p className="text-sm text-muted-foreground">
            {result.hashOverlapCount === null
              ? 'Hash overlap: not meaningful (one or both sides returned no infoHash).'
              : `Hash overlap: ${result.hashOverlapCount} result${result.hashOverlapCount === 1 ? '' : 's'} on B share an infohash with A.`}
          </p>
        </section>
      )}
    </div>
  )
}
