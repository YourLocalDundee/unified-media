/**
 * Import Lists card for /admin/automation. Manages Trakt/RSS lists that auto-add titles as long-term
 * monitored items. Self-contained: fetches its own list state; takes the quality-profile options from
 * the parent. Includes the Trakt client-id setting (stored in app_settings via /api/admin/settings).
 */
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Trash2, RefreshCw, ListPlus } from 'lucide-react'

interface ImportList {
  id: number
  name: string
  list_type: 'trakt' | 'rss'
  url: string
  enabled: number
  quality_profile_id: number
  media_type: 'movie' | 'tv'
  last_sync_at: number | null
  last_error: string | null
  added_count: number
}

interface ProfileOption { id: number; name: string }

export default function ImportListsCard({ profiles }: { profiles: ProfileOption[] }) {
  const [lists, setLists] = useState<ImportList[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null) // list id mid-action

  // Add form
  const [name, setName] = useState('')
  const [listType, setListType] = useState<'trakt' | 'rss'>('trakt')
  const [url, setUrl] = useState('')
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie')
  const [profileId, setProfileId] = useState<number>(1)
  const [formError, setFormError] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Trakt client id setting
  const [traktClientId, setTraktClientId] = useState('')
  const [traktSaved, setTraktSaved] = useState(false)

  const fetchLists = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/automation/import-lists')
      if (res.ok) {
        const data = (await res.json()) as { lists: ImportList[] }
        setLists(data.lists)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => {
      void fetchLists()
      void fetch('/api/admin/settings')
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d && typeof d.trakt_client_id === 'string') setTraktClientId(d.trakt_client_id) })
        .catch(() => {})
    }, 0)
    return () => clearTimeout(id)
  }, [fetchLists])

  async function saveTrakt() {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trakt_client_id: traktClientId.trim() }),
    })
    if (res.ok) {
      setTraktSaved(true)
      setTimeout(() => setTraktSaved(false), 1800)
    }
  }

  async function addList() {
    setFormError(null)
    if (!name.trim() || !url.trim()) { setFormError('Name and URL are required'); return }
    const res = await fetch('/api/automation/import-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, listType, url, mediaType, qualityProfileId: profileId }),
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      setFormError(d.error ?? 'Failed to add list')
      return
    }
    setName(''); setUrl('')
    await fetchLists()
  }

  async function toggleEnabled(list: ImportList) {
    setBusy(list.id)
    try {
      await fetch(`/api/automation/import-lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: list.enabled === 0 }),
      })
      await fetchLists()
    } finally {
      setBusy(null)
    }
  }

  async function syncNow(list: ImportList) {
    setBusy(list.id)
    setSyncMsg(null)
    try {
      const res = await fetch(`/api/automation/import-lists/${list.id}/sync`, { method: 'POST' })
      const d = (await res.json().catch(() => ({}))) as { added?: number; seen?: number; error?: string }
      setSyncMsg(d.error ? `${list.name}: ${d.error}` : `${list.name}: added ${d.added ?? 0} of ${d.seen ?? 0} seen`)
      await fetchLists()
    } finally {
      setBusy(null)
    }
  }

  async function deleteList(list: ImportList) {
    if (!confirm(`Delete import list "${list.name}"? Titles already added stay in the library.`)) return
    setBusy(list.id)
    try {
      await fetch(`/api/automation/import-lists/${list.id}`, { method: 'DELETE' })
      await fetchLists()
    } finally {
      setBusy(null)
    }
  }

  const inputCls = 'rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <ListPlus className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">Import Lists</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Auto-add titles from a Trakt list or RSS feed. Every add is long-term (never auto-deleted).
      </p>

      {/* Trakt client id */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground mb-1">Trakt client ID (for Trakt lists)</label>
          <input value={traktClientId} onChange={e => setTraktClientId(e.target.value)} placeholder="trakt-api client id" className={`${inputCls} w-72`} />
        </div>
        <button onClick={saveTrakt} className="rounded-md px-3 py-1.5 text-sm bg-secondary text-secondary-foreground hover:opacity-90">
          {traktSaved ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Add form */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="List name" className={`${inputCls} w-40`} />
        <select value={listType} onChange={e => setListType(e.target.value as 'trakt' | 'rss')} className={inputCls}>
          <option value="trakt">Trakt</option>
          <option value="rss">RSS</option>
        </select>
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder={listType === 'trakt' ? 'https://api.trakt.tv/users/…/items' : 'https://…/feed.xml'} className={`${inputCls} flex-1 min-w-[16rem]`} />
        {listType === 'rss' && (
          <select value={mediaType} onChange={e => setMediaType(e.target.value as 'movie' | 'tv')} className={inputCls} title="RSS items resolve to this media type">
            <option value="movie">Movies</option>
            <option value="tv">TV</option>
          </select>
        )}
        <select value={profileId} onChange={e => setProfileId(parseInt(e.target.value, 10))} className={inputCls} title="Quality profile">
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={addList} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {formError && <p className="mb-3 text-xs text-destructive">{formError}</p>}
      {syncMsg && <p className="mb-3 text-xs text-muted-foreground">{syncMsg}</p>}

      {/* List table */}
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : lists.length === 0 ? (
        <p className="text-sm text-muted-foreground">No import lists configured.</p>
      ) : (
        <div className="divide-y divide-border">
          {lists.map(list => (
            <div key={list.id} className="flex items-center gap-3 py-2.5">
              <button
                onClick={() => toggleEnabled(list)}
                disabled={busy === list.id}
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${list.enabled ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}
                title={list.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
              >
                {list.enabled ? 'On' : 'Off'}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {list.name} <span className="text-xs uppercase text-muted-foreground">{list.list_type}</span>
                </p>
                <p className="text-xs text-muted-foreground truncate">{list.url}</p>
                <p className="text-xs text-muted-foreground">
                  added {list.added_count}
                  {list.last_sync_at ? ` · synced ${new Date(list.last_sync_at).toLocaleString()}` : ' · never synced'}
                  {list.last_error ? <span className="text-destructive"> · {list.last_error}</span> : null}
                </p>
              </div>
              <button onClick={() => syncNow(list)} disabled={busy === list.id} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent" title="Sync now">
                {busy === list.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button onClick={() => deleteList(list)} disabled={busy === list.id} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-accent" title="Delete list">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
