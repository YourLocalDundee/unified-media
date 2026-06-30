/**
 * Admin Collections Page (/admin/collections)
 *
 * Monitor a TMDB franchise collection (e.g. "The Lord of the Rings Collection") as a unit.
 * Every film in it gets auto-added to monitored_items, including future entries when the daily
 * cron re-syncs.
 *
 * Features:
 *   - Search TMDB collections by name (via /api/tmdb/collections/search)
 *   - Add a collection to monitoring (with quality profile selection)
 *   - List monitored collections with sync status, added count, enabled toggle
 *   - Manual sync button per collection
 *   - Delete a collection (films already added stay in the library)
 */
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Plus, Trash2, RefreshCw, Library, Search, X } from 'lucide-react'

interface MonitoredCollection {
  id: number
  tmdb_collection_id: number
  name: string
  quality_profile_id: number
  enabled: number
  last_sync_at: number | null
  last_error: string | null
  added_count: number
}

interface QualityProfile {
  id: number
  name: string
}

interface TmdbCollectionResult {
  id: number
  name: string
  poster_path: string | null
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const inputCls =
  'rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

export default function AdminCollectionsPage() {
  const [collections, setCollections] = useState<MonitoredCollection[]>([])
  const [profiles, setProfiles] = useState<QualityProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TmdbCollectionResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState<TmdbCollectionResult | null>(null)

  // Add-form state
  const [selectedProfileId, setSelectedProfileId] = useState<number>(1)
  const [formError, setFormError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCollections = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/collections')
      if (res.ok) {
        const data = (await res.json()) as { collections: MonitoredCollection[] }
        setCollections(data.collections)
      }
    } catch {
      setError('Failed to load collections')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/profiles')
      if (res.ok) setProfiles((await res.json()) as QualityProfile[])
    } catch {
      // non-fatal — profile dropdown will just be empty
    }
  }, [])

  // Deferred a tick (react-hooks/set-state-in-effect)
  useEffect(() => {
    const id = setTimeout(() => {
      void fetchCollections()
      void fetchProfiles()
    }, 0)
    return () => clearTimeout(id)
  }, [fetchCollections, fetchProfiles])

  // Debounced TMDB collection search
  function handleSearchInput(value: string) {
    setSearchQuery(value)
    setSelectedCollection(null)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!value.trim()) {
      setSearchResults([])
      return
    }
    searchTimeoutRef.current = setTimeout(() => {
      void (async () => {
        setSearching(true)
        try {
          const res = await fetch(`/api/tmdb/collections/search?q=${encodeURIComponent(value.trim())}`)
          if (res.ok) setSearchResults((await res.json()) as TmdbCollectionResult[])
        } finally {
          setSearching(false)
        }
      })()
    }, 400)
  }

  function selectResult(r: TmdbCollectionResult) {
    setSelectedCollection(r)
    setSearchQuery(r.name)
    setSearchResults([])
    setFormError(null)
  }

  function clearSelection() {
    setSelectedCollection(null)
    setSearchQuery('')
    setSearchResults([])
    setFormError(null)
  }

  async function addCollection() {
    setFormError(null)
    if (!selectedCollection) {
      setFormError('Select a collection from the search results first')
      return
    }
    setAdding(true)
    try {
      const res = await fetch('/api/admin/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdb_collection_id: selectedCollection.id,
          name: selectedCollection.name,
          quality_profile_id: selectedProfileId,
        }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setFormError(d.error ?? 'Failed to add collection')
        return
      }
      clearSelection()
      await fetchCollections()
    } finally {
      setAdding(false)
    }
  }

  async function toggleEnabled(col: MonitoredCollection) {
    setBusy(col.id)
    try {
      await fetch(`/api/admin/collections/${col.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: col.enabled === 0 }),
      })
      await fetchCollections()
    } finally {
      setBusy(null)
    }
  }

  async function syncNow(col: MonitoredCollection) {
    setBusy(col.id)
    setSyncMsg(null)
    try {
      const res = await fetch(`/api/admin/collections/${col.id}/sync`, { method: 'POST' })
      const d = (await res.json().catch(() => ({}))) as { added?: number; error?: string }
      setSyncMsg(
        d.error ? `${col.name}: ${d.error}` : `${col.name}: added ${d.added ?? 0} new film(s)`,
      )
      await fetchCollections()
    } finally {
      setBusy(null)
    }
  }

  async function deleteCollection(col: MonitoredCollection) {
    if (!confirm(`Remove "${col.name}" from monitoring? Films already added stay in the library.`)) return
    setBusy(col.id)
    try {
      await fetch(`/api/admin/collections/${col.id}`, { method: 'DELETE' })
      await fetchCollections()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Movie Collections</h1>
      <p className="text-sm text-muted-foreground -mt-6">
        Monitor a TMDB franchise as a unit. Every film is auto-added to the want list, including future
        entries discovered by the daily re-sync.
      </p>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline text-xs">dismiss</button>
        </div>
      )}

      {/* Add collection */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Library className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Add Collection</h2>
        </div>

        <div className="flex flex-wrap items-end gap-2 mb-2">
          {/* Search input with results dropdown */}
          <div className="relative flex-1 min-w-[16rem]">
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={e => handleSearchInput(e.target.value)}
                  placeholder="Search TMDB collections…"
                  className={`${inputCls} w-full pl-8`}
                />
              </div>
              {(searchQuery || selectedCollection) && (
                <button
                  onClick={clearSelection}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Dropdown results */}
            {(searchResults.length > 0 || searching) && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-60 overflow-y-auto">
                {searching && (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                  </div>
                )}
                {searchResults.map(r => (
                  <button
                    key={r.id}
                    onClick={() => selectResult(r)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">TMDB #{r.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quality profile */}
          <select
            value={selectedProfileId}
            onChange={e => setSelectedProfileId(parseInt(e.target.value, 10))}
            className={inputCls}
            title="Quality profile"
          >
            {profiles.length === 0 && <option value={1}>Default (Any)</option>}
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            onClick={() => void addCollection()}
            disabled={adding || !selectedCollection}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>

        {selectedCollection && (
          <p className="text-xs text-muted-foreground mt-1">
            Selected: <span className="text-foreground font-medium">{selectedCollection.name}</span>
            {' '}(TMDB #{selectedCollection.id})
          </p>
        )}
        {formError && <p className="mt-2 text-xs text-destructive">{formError}</p>}
      </section>

      {syncMsg && (
        <p className="text-xs text-muted-foreground">{syncMsg}</p>
      )}

      {/* Monitored collections list */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Monitored Collections {!loading && `(${collections.length})`}
        </h2>

        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : collections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No collections monitored yet. Search for a franchise above to get started.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Collection', 'TMDB ID', 'Quality Profile', 'Films Added', 'Last Sync', 'Enabled', 'Actions'].map((h, i) => (
                    <th key={i} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {collections.map(col => (
                  <tr key={col.id}>
                    <td className="px-4 py-2 font-medium text-foreground">
                      {col.name}
                      {col.last_error && (
                        <span className="ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30" title={col.last_error}>
                          error
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{col.tmdb_collection_id}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {profiles.find(p => p.id === col.quality_profile_id)?.name ?? `#${col.quality_profile_id}`}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{col.added_count}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {col.last_sync_at ? relativeTime(col.last_sync_at) : 'Never'}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => void toggleEnabled(col)}
                        disabled={busy === col.id}
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${col.enabled ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}
                        title={col.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                      >
                        {col.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void syncNow(col)}
                          disabled={busy === col.id}
                          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                          title="Sync now"
                        >
                          {busy === col.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => void deleteCollection(col)}
                          disabled={busy === col.id}
                          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-accent"
                          title="Remove from monitoring"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
