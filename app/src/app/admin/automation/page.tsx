/**
 * Admin Automation Page (/admin/automation)
 *
 * Primary admin UI for the download automation pipeline. Shows two sections:
 *   1. Monitored Items — the full want list with per-item Grab Now and Delete actions
 *   2. Recent Grabs — the last 100 grab_history entries with expandable full-list toggle
 *
 * The "Add Item" modal lets admins manually add items to the want list without going
 * through the request system (useful for backfills or content not on TMDB).
 *
 * All data is fetched client-side on mount; no live polling (admin manually refreshes).
 * Grab state is tracked per item-id so multiple concurrent grabs can be in-flight.
 */

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { Loader2, Trash2, Play, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'

interface MonitoredItem {
  id: number
  tmdb_id: number | null
  tvdb_id: number | null
  type: 'movie' | 'tv'
  title: string
  year: number | null
  quality_profile_id: number
  root_path: string
  monitored: number
  status: 'wanted' | 'grabbed' | 'imported' | 'ignored'
  created_at: number
  updated_at: number
  // Decision gate-chain fields (LEFT JOINed from grab_results)
  last_searched_at: number | null
  last_skip_reason: string | null
  last_selected_hash: string | null
}

type SkipReason = 'no_results' | 'scope_mismatch' | 'language_mismatch' | 'quality_reject' | 'degenerate_scope'

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  no_results:       'No indexer hits',
  scope_mismatch:   'Scope filter: no match',
  language_mismatch:'Wrong language',
  quality_reject:   'Quality profile: rejected',
  degenerate_scope: 'Empty scope',
}

const SKIP_REASON_CLASS: Record<SkipReason, string> = {
  no_results:       'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30',
  scope_mismatch:   'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  language_mismatch:'bg-violet-500/20 text-violet-400 border border-violet-500/30',
  quality_reject:   'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  degenerate_scope: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

interface QualityProfile {
  id: number
  name: string
  conditions: string
}

interface GrabHistory {
  id: number
  item_id: number
  indexer: string
  release_title: string
  info_hash: string
  grabbed_at: number
  import_status: string
}

// Static Tailwind class maps avoid dynamic class construction which can be purged by the compiler
const STATUS_BADGE: Record<MonitoredItem['status'], string> = {
  wanted:   'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  grabbed:  'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  imported: 'bg-green-500/20 text-green-400 border border-green-500/30',
  ignored:  'bg-muted text-muted-foreground border border-border',
}

// import_status lives on grab_history rows; separate map from item status badges
const IMPORT_STATUS_BADGE: Record<string, string> = {
  pending:  'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  imported: 'bg-green-500/20 text-green-400 border border-green-500/30',
  failed:   'bg-red-500/20 text-red-400 border border-red-500/30',
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function AdminAutomationPage() {
  const [items, setItems] = useState<MonitoredItem[]>([])
  const [profiles, setProfiles] = useState<QualityProfile[]>([])
  const [history, setHistory] = useState<GrabHistory[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState('')

  // grabState maps item.id → current grab status string; absent key means idle
  const [grabState, setGrabState] = useState<Record<number, string>>({})

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formType, setFormType] = useState<'movie' | 'tv'>('movie')
  const [formYear, setFormYear] = useState('')
  const [formProfile, setFormProfile] = useState('')
  const [formTmdbId, setFormTmdbId] = useState('')
  const [formRootPath, setFormRootPath] = useState('')
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  // Show-all toggle for recent grabs
  const [showAllGrabs, setShowAllGrabs] = useState(false)

  const fetchItems = useCallback(async () => {
    setLoadingItems(true)
    try {
      const res = await fetch('/api/automation/items')
      if (!res.ok) throw new Error(`Failed to load items (${res.status})`)
      setItems(await res.json() as MonitoredItem[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load items')
    } finally {
      setLoadingItems(false)
    }
  }, [])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/profiles')
      if (res.ok) setProfiles(await res.json() as QualityProfile[])
      // Profiles are only needed for the "Add Item" dropdown — failure is non-fatal;
      // the dropdown will just be empty and the API will use the default profile
    } catch {
      // non-fatal
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/automation/queue')
      if (!res.ok) throw new Error(`Failed to load grab history (${res.status})`)
      setHistory(await res.json() as GrabHistory[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grab history')
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  // Deferred a tick so the loading setStates in the fetchers run outside the effect's
  // synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => {
      void fetchItems()
      void fetchProfiles()
      void fetchHistory()
    }, 0)
    return () => clearTimeout(id)
  }, [fetchItems, fetchProfiles, fetchHistory])

  async function handleGrab(item: MonitoredItem) {
    setGrabState(s => ({ ...s, [item.id]: 'loading' }))
    try {
      const res = await fetch(`/api/automation/items/${item.id}/grab`, { method: 'POST' })
      const data = await res.json() as { result: string }
      setGrabState(s => ({ ...s, [item.id]: data.result }))
      // On success, refresh both tables so status badge and grab history update immediately
      if (data.result === 'grabbed') {
        void fetchItems()
        void fetchHistory()
      }
      // Auto-clear the per-item result after 4s so the button returns to its default state
      setTimeout(() => setGrabState(s => { const n = { ...s }; delete n[item.id]; return n }), 4000)
    } catch {
      setGrabState(s => ({ ...s, [item.id]: 'error' }))
      setTimeout(() => setGrabState(s => { const n = { ...s }; delete n[item.id]; return n }), 4000)
    }
  }

  async function handleDelete(item: MonitoredItem) {
    if (!window.confirm(`Delete "${item.title}" from monitoring? This cannot be undone.`)) return
    try {
      await fetch(`/api/automation/items/${item.id}`, { method: 'DELETE' })
      void fetchItems()
    } catch {
      setError('Failed to delete item')
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!formTitle.trim()) { setFormError('Title is required'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/automation/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          type: formType,
          year: formYear ? parseInt(formYear, 10) : undefined,
          quality_profile_id: formProfile ? parseInt(formProfile, 10) : undefined,
          tmdb_id: formTmdbId ? parseInt(formTmdbId, 10) : undefined,
          root_path: formRootPath || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setFormError(data.error ?? 'Failed to add item')
        return
      }
      setShowModal(false)
      setFormTitle('')
      setFormType('movie')
      setFormYear('')
      setFormProfile('')
      setFormTmdbId('')
      setFormRootPath('')
      void fetchItems()
    } finally {
      setCreating(false)
    }
  }

  const closeModal = useCallback(() => {
    setShowModal(false)
    setFormError('')
    setFormTitle('')
    setFormType('movie')
    setFormYear('')
    setFormProfile('')
    setFormTmdbId('')
    setFormRootPath('')
  }, [])

  useFocusTrap(modalRef, showModal, closeModal)

  // Build id→name lookup so table rows can display the profile name instead of the raw id
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p.name]))
  // Show last 20 grabs by default; "Show all" expands to full 100-row cap from the API
  const displayedHistory = showAllGrabs ? history : history.slice(0, 20)

  // Label and class helpers keep the JSX rows clean; both derive from grabState[id]
  function grabButtonLabel(id: number): React.ReactNode {
    const state = grabState[id]
    if (!state) return <><Play className="h-3 w-3" />Grab Now</>
    if (state === 'loading') return <><Loader2 className="h-3 w-3 animate-spin" />Grabbing…</>
    if (state === 'grabbed') return 'Grabbed!'
    if (state === 'not_found') return 'Not found'
    return 'Error'
  }

  function grabButtonClass(id: number): string {
    const state = grabState[id]
    const base = 'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors'
    if (!state || state === 'loading') return `${base} bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50`
    if (state === 'grabbed') return `${base} bg-green-500/20 text-green-400`
    if (state === 'not_found') return `${base} bg-yellow-500/20 text-yellow-400`
    return `${base} bg-red-500/20 text-red-400`  // covers 'error' and any unexpected state
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Download Automation</h1>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={() => setError('')} className="ml-3 underline text-xs">dismiss</button>
        </div>
      )}

      {/* Monitored Items */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">
            Monitored Items {!loadingItems && `(${items.length})`}
          </h2>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>

        {loadingItems ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Title', 'Type', 'Year', 'Status', 'Quality Profile', 'Last Search', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map(item => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 font-medium text-foreground">{item.title}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        item.type === 'movie'
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      }`}>
                        {item.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{item.year ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[item.status]}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {profileMap[item.quality_profile_id] ?? `#${item.quality_profile_id}`}
                    </td>
                    <td className="px-4 py-2">
                      {item.last_searched_at == null ? (
                        <span className="text-xs text-muted-foreground">Never</span>
                      ) : item.last_selected_hash != null ? (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                          Grabbed
                        </span>
                      ) : item.last_skip_reason != null ? (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SKIP_REASON_CLASS[item.last_skip_reason as SkipReason] ?? 'bg-muted text-muted-foreground border border-border'}`}
                          title={`${relativeTime(item.last_searched_at)}`}
                        >
                          {SKIP_REASON_LABEL[item.last_skip_reason as SkipReason] ?? item.last_skip_reason}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void handleGrab(item)}
                          disabled={grabState[item.id] === 'loading'}
                          className={grabButtonClass(item.id)}
                        >
                          {grabButtonLabel(item.id)}
                        </button>
                        <button
                          onClick={() => void handleDelete(item)}
                          className="rounded p-1 hover:bg-red-500/20 text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No monitored items. Add one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent Grabs */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Recent Grabs {!loadingHistory && `(${history.length})`}
        </h2>

        {loadingHistory ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Release Title', 'Indexer', 'Item', 'Grabbed', 'Status'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayedHistory.map(grab => {
                    // Cross-reference grab history with the loaded items list for display name;
                    // falls back to numeric ID if the item was deleted after the grab was recorded
                    const linkedItem = items.find(i => i.id === grab.item_id)
                    return (
                      <tr key={grab.id}>
                        <td className="px-4 py-2 font-mono text-xs text-foreground max-w-xs truncate" title={grab.release_title}>
                          {grab.release_title}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{grab.indexer}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {linkedItem ? linkedItem.title : <span className="opacity-50">#{grab.item_id}</span>}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{relativeTime(grab.grabbed_at)}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${IMPORT_STATUS_BADGE[grab.import_status] ?? 'bg-muted text-muted-foreground border border-border'}`}>
                            {grab.import_status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No grabs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {history.length > 20 && (
              <button
                onClick={() => setShowAllGrabs(v => !v)}
                className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showAllGrabs
                  ? <><ChevronUp className="h-3 w-3" />Show less</>
                  : <><ChevronDown className="h-3 w-3" />Show all {history.length} grabs</>
                }
              </button>
            )}
          </>
        )}
      </section>

      {/* Add Item Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-item-title"
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 id="add-item-title" className="text-lg font-semibold">Add Monitored Item</h2>
              <button onClick={closeModal} className="rounded p-1 hover:bg-muted" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={e => void handleCreate(e)} className="space-y-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="e.g. The Matrix"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {formError && formError.toLowerCase().includes('title') && (
                  <p className="mt-1 text-xs text-red-400">{formError}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-2">Type</label>
                <div className="flex gap-4">
                  {(['movie', 'tv'] as const).map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="type"
                        value={t}
                        checked={formType === t}
                        onChange={() => setFormType(t)}
                        className="accent-primary"
                      />
                      <span className="text-sm capitalize">{t === 'tv' ? 'TV Show' : 'Movie'}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Year (optional)</label>
                  <input
                    type="number"
                    value={formYear}
                    onChange={e => setFormYear(e.target.value)}
                    placeholder="2024"
                    min={1900}
                    max={2100}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">TMDB ID (optional)</label>
                  <input
                    type="number"
                    value={formTmdbId}
                    onChange={e => setFormTmdbId(e.target.value)}
                    placeholder="603"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">Quality Profile</label>
                <select
                  value={formProfile}
                  onChange={e => setFormProfile(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="">Default (Any)</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">Root Path (optional)</label>
                <input
                  value={formRootPath}
                  onChange={e => setFormRootPath(e.target.value)}
                  placeholder="/media/movies"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {formError && !formError.toLowerCase().includes('title') && (
                <p className="text-xs text-red-400">{formError}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  Add Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
