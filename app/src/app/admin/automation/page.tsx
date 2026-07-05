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
import ImportListsCard from './ImportListsCard'
import { Loader2, Trash2, Play, ChevronDown, ChevronUp, Plus, X, Ban, SlidersHorizontal, Bell, ArrowUpCircle } from 'lucide-react'
import { useGrabConfirm } from '@/components/media/GrabConfirmModal'

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
  status: 'wanted' | 'grabbed' | 'imported' | 'ignored' | 'failed'
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

// One blocklisted release (gate-chain). Hashes here are hard-gated out of every auto-grab.
interface BlocklistRow {
  info_hash: string
  title: string | null
  reason: string | null
  blocked_at: number
}

// app_settings keys that tune the hard gates (see lib/automation/gates.ts). Stored as strings.
interface GateSettings {
  gate_min_seeders: string
  gate_max_size_movie_gb: string
  gate_max_size_tv_gb: string
}

const GATE_DEFAULTS: GateSettings = {
  gate_min_seeders: '1',
  gate_max_size_movie_gb: '100',
  gate_max_size_tv_gb: '200',
}

// app_settings keys for outbound notifications (see lib/notify). Stored as strings.
interface NotifySettings {
  notify_on_available: string // '1' | '0'
  notify_discord_webhook: string
  notify_ntfy_url: string
}

const NOTIFY_DEFAULTS: NotifySettings = {
  notify_on_available: '1',
  notify_discord_webhook: '',
  notify_ntfy_url: '',
}

// Upgrade-until-cutoff rows (lib/automation/upgrade).
interface UpgradeListRow {
  id: number
  item_id: number
  title: string | null
  new_release: string
  status: string
  created_at: number
  completed_at: number | null
}

// Static Tailwind class maps avoid dynamic class construction which can be purged by the compiler
const STATUS_BADGE: Record<MonitoredItem['status'], string> = {
  wanted:   'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  grabbed:  'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  imported: 'bg-green-500/20 text-green-400 border border-green-500/30',
  ignored:  'bg-muted text-muted-foreground border border-border',
  failed:   'bg-red-500/20 text-red-400 border border-red-500/30',
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

  // Grab-gate thresholds (Part 1). Held as strings to match the app_settings storage model.
  const [gate, setGate] = useState<GateSettings>(GATE_DEFAULTS)
  const [gateSaving, setGateSaving] = useState(false)
  const [gateSaved, setGateSaved] = useState(false)
  const [gateError, setGateError] = useState('')

  // Notifications.
  const [notify, setNotify] = useState<NotifySettings>(NOTIFY_DEFAULTS)
  const [notifySaving, setNotifySaving] = useState(false)
  const [notifySaved, setNotifySaved] = useState(false)
  const [notifyError, setNotifyError] = useState('')
  const [notifyTesting, setNotifyTesting] = useState(false)
  const [notifyTestMsg, setNotifyTestMsg] = useState('')

  // Upgrades.
  const [upgrades, setUpgrades] = useState<UpgradeListRow[]>([])
  const [upgradeScanning, setUpgradeScanning] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')

  // Blocklist (Part 2).
  const [blocklist, setBlocklist] = useState<BlocklistRow[]>([])
  const [loadingBlocklist, setLoadingBlocklist] = useState(true)
  const [blockHash, setBlockHash] = useState('')
  const [blockTitle, setBlockTitle] = useState('')
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockError, setBlockError] = useState('')

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

  // Refresh both tables once a grab is actually confirmed (mirrors the old immediate-grab
  // success path, which also refreshed items + history).
  const { openGrabConfirm, grabConfirmModal } = useGrabConfirm(() => { void fetchItems(); void fetchHistory() })

  const fetchGate = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings')
      if (!res.ok) return // non-fatal; inputs keep their defaults
      const data = await res.json() as Record<string, string>
      setGate({
        gate_min_seeders: data.gate_min_seeders ?? GATE_DEFAULTS.gate_min_seeders,
        gate_max_size_movie_gb: data.gate_max_size_movie_gb ?? GATE_DEFAULTS.gate_max_size_movie_gb,
        gate_max_size_tv_gb: data.gate_max_size_tv_gb ?? GATE_DEFAULTS.gate_max_size_tv_gb,
      })
      setNotify({
        notify_on_available: data.notify_on_available ?? NOTIFY_DEFAULTS.notify_on_available,
        notify_discord_webhook: data.notify_discord_webhook ?? NOTIFY_DEFAULTS.notify_discord_webhook,
        notify_ntfy_url: data.notify_ntfy_url ?? NOTIFY_DEFAULTS.notify_ntfy_url,
      })
    } catch {
      // non-fatal — leave defaults in place
    }
  }, [])

  const fetchBlocklist = useCallback(async () => {
    setLoadingBlocklist(true)
    try {
      const res = await fetch('/api/automation/blocklist')
      if (!res.ok) throw new Error(`Failed to load blocklist (${res.status})`)
      const data = await res.json() as { blocklist: BlocklistRow[] }
      setBlocklist(data.blocklist)
    } catch (e) {
      setBlockError(e instanceof Error ? e.message : 'Failed to load blocklist')
    } finally {
      setLoadingBlocklist(false)
    }
  }, [])

  const fetchUpgrades = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/upgrades')
      if (!res.ok) return
      const data = await res.json() as { upgrades: UpgradeListRow[] }
      setUpgrades(data.upgrades)
    } catch {
      // non-fatal — leave the list empty
    }
  }, [])

  // Deferred a tick so the loading setStates in the fetchers run outside the effect's
  // synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => {
      void fetchItems()
      void fetchProfiles()
      void fetchHistory()
      void fetchGate()
      void fetchBlocklist()
      void fetchUpgrades()
    }, 0)
    return () => clearTimeout(id)
  }, [fetchItems, fetchProfiles, fetchHistory, fetchGate, fetchBlocklist, fetchUpgrades])

  // "Grab Now" used to POST straight to the grab route and commit immediately with no chance to
  // see or veto the pick — now it opens the grab-confirmation modal against the existing item.
  function handleGrab(item: MonitoredItem) {
    if (item.tmdb_id == null) return // no tmdb_id (manually-added item) — nothing to confirm against
    openGrabConfirm({ itemId: item.id, tmdbId: item.tmdb_id, type: item.type, title: item.title, year: item.year })
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

  async function saveGate() {
    setGateSaving(true)
    setGateSaved(false)
    setGateError('')
    // Clamp to sane, non-negative integers; 0 on a max-size disables that cap (gates.ts).
    const clean = (v: string, def: string) => {
      const n = parseInt(v, 10)
      return Number.isFinite(n) && n >= 0 ? String(n) : def
    }
    const payload: GateSettings = {
      gate_min_seeders: clean(gate.gate_min_seeders, GATE_DEFAULTS.gate_min_seeders),
      gate_max_size_movie_gb: clean(gate.gate_max_size_movie_gb, GATE_DEFAULTS.gate_max_size_movie_gb),
      gate_max_size_tv_gb: clean(gate.gate_max_size_tv_gb, GATE_DEFAULTS.gate_max_size_tv_gb),
    }
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Save failed (HTTP ${res.status})`)
      setGate(payload) // reflect the clamped values back into the inputs
      setGateSaved(true)
      setTimeout(() => setGateSaved(false), 2500)
    } catch (e) {
      setGateError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setGateSaving(false)
    }
  }

  async function saveNotify() {
    setNotifySaving(true)
    setNotifySaved(false)
    setNotifyError('')
    setNotifyTestMsg('')
    const payload: NotifySettings = {
      notify_on_available: notify.notify_on_available === '1' ? '1' : '0',
      notify_discord_webhook: notify.notify_discord_webhook.trim(),
      notify_ntfy_url: notify.notify_ntfy_url.trim(),
    }
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Save failed (HTTP ${res.status})`)
      setNotify(payload)
      setNotifySaved(true)
      setTimeout(() => setNotifySaved(false), 2500)
    } catch (e) {
      setNotifyError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setNotifySaving(false)
    }
  }

  async function testNotify() {
    setNotifyTesting(true)
    setNotifyTestMsg('')
    setNotifyError('')
    try {
      const res = await fetch('/api/admin/notify/test', { method: 'POST' })
      const data = await res.json() as
        | { ok: true; results: { channel: string; ok: boolean; error?: string }[] }
        | { ok: false; error?: string; results?: { channel: string; ok: boolean; error?: string }[] }
      if (!res.ok && !data.results) {
        setNotifyTestMsg(('error' in data && data.error) ? data.error : `Test failed (HTTP ${res.status})`)
        return
      }
      const parts = (data.results ?? []).map(
        (r) => `${r.channel}: ${r.ok ? 'sent ✓' : `failed (${r.error ?? 'error'})`}`,
      )
      setNotifyTestMsg(parts.length ? parts.join(' · ') : 'No channels configured.')
    } catch (e) {
      setNotifyTestMsg(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setNotifyTesting(false)
    }
  }

  async function scanUpgradesNow() {
    setUpgradeScanning(true)
    setUpgradeMsg('')
    try {
      const res = await fetch('/api/automation/upgrades', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; scanned?: number; upgraded?: number; error?: string }
      if (!res.ok) {
        setUpgradeMsg(data.error ?? `Scan failed (HTTP ${res.status})`)
        return
      }
      setUpgradeMsg(`Scanned ${data.scanned ?? 0} movie(s), grabbed ${data.upgraded ?? 0} upgrade(s).`)
      await fetchUpgrades()
    } catch (e) {
      setUpgradeMsg(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setUpgradeScanning(false)
    }
  }

  async function blockAdd(e: React.FormEvent) {
    e.preventDefault()
    setBlockError('')
    const infoHash = blockHash.trim()
    if (!infoHash) { setBlockError('Info hash is required'); return }
    setBlockBusy(true)
    try {
      const res = await fetch('/api/automation/blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infoHash, title: blockTitle.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Block failed (HTTP ${res.status})`)
      }
      setBlockHash('')
      setBlockTitle('')
      void fetchBlocklist()
    } catch (e) {
      setBlockError(e instanceof Error ? e.message : 'Block failed')
    } finally {
      setBlockBusy(false)
    }
  }

  async function blockRemove(infoHash: string) {
    setBlockError('')
    try {
      const res = await fetch('/api/automation/blocklist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infoHash }),
      })
      if (!res.ok) throw new Error(`Unblock failed (HTTP ${res.status})`)
      void fetchBlocklist()
    } catch (e) {
      setBlockError(e instanceof Error ? e.message : 'Unblock failed')
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

  return (
    <div className="space-y-8">
      {grabConfirmModal}
      <h1 className="text-2xl font-bold text-foreground">Download Automation</h1>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={() => setError('')} className="ml-3 underline text-xs">dismiss</button>
        </div>
      )}

      {/* Grab Gates (Part 1) — hard thresholds applied before any auto-grab (gates.ts). */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Grab Gates</h2>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Hard limits applied to every <span className="font-medium text-foreground">automatic</span> grab.
            A release that fails any gate is never auto-grabbed (the interactive picker can still override it).
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Minimum seeders</span>
              <input
                type="number"
                min={0}
                value={gate.gate_min_seeders}
                onChange={e => setGate(g => ({ ...g, gate_min_seeders: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-[11px] text-muted-foreground">Below this is gated as “dead”. Default 1.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Max movie size (GB)</span>
              <input
                type="number"
                min={0}
                value={gate.gate_max_size_movie_gb}
                onChange={e => setGate(g => ({ ...g, gate_max_size_movie_gb: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-[11px] text-muted-foreground">0 disables the cap. Default 100.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Max TV size (GB)</span>
              <input
                type="number"
                min={0}
                value={gate.gate_max_size_tv_gb}
                onChange={e => setGate(g => ({ ...g, gate_max_size_tv_gb: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-[11px] text-muted-foreground">0 disables the cap. Default 200.</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void saveGate()}
              disabled={gateSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {gateSaving ? 'Saving…' : 'Save gates'}
            </button>
            <p aria-live="polite" className="text-sm">
              {gateSaved && <span className="text-green-400">Saved.</span>}
              {gateError && <span className="text-red-400">{gateError}</span>}
            </p>
          </div>
        </div>
      </section>

      {/* Notifications — fired when a requested item becomes available (lib/notify). */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Sent when a requested item becomes <span className="font-medium text-foreground">available</span> in
            the library. Configure a Discord webhook and/or an ntfy topic; leave a field blank to disable that channel.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={notify.notify_on_available === '1'}
              onChange={e => setNotify(n => ({ ...n, notify_on_available: e.target.checked ? '1' : '0' }))}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm text-foreground">Notify when requested media becomes available</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Discord webhook URL</span>
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/…"
              value={notify.notify_discord_webhook}
              onChange={e => setNotify(n => ({ ...n, notify_discord_webhook: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">ntfy topic URL</span>
            <input
              type="url"
              placeholder="https://ntfy.sh/your-topic"
              value={notify.notify_ntfy_url}
              onChange={e => setNotify(n => ({ ...n, notify_ntfy_url: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[11px] text-muted-foreground">Full URL including the topic, e.g. https://ntfy.sh/minime-media.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void saveNotify()}
              disabled={notifySaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {notifySaving ? 'Saving…' : 'Save notifications'}
            </button>
            <button
              onClick={() => void testNotify()}
              disabled={notifyTesting}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              {notifyTesting ? 'Sending…' : 'Send test'}
            </button>
            <p aria-live="polite" className="text-sm">
              {notifySaved && <span className="text-green-400">Saved.</span>}
              {notifyError && <span className="text-red-400">{notifyError}</span>}
              {notifyTestMsg && <span className="text-muted-foreground">{notifyTestMsg}</span>}
            </p>
          </div>
        </div>
      </section>

      {/* Upgrades — upgrade-until-cutoff (lib/automation/upgrade). Movies only in v1. */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ArrowUpCircle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Upgrades</h2>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Imported <span className="font-medium text-foreground">movies</span> whose quality profile allows
            upgrades and whose release is still below the profile cutoff are re-searched every 6 hours; a
            strictly-better release is grabbed and swapped in. (TV upgrades are not yet supported.)
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void scanUpgradesNow()}
              disabled={upgradeScanning}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {upgradeScanning ? 'Scanning…' : 'Scan for upgrades now'}
            </button>
            <p aria-live="polite" className="text-sm text-muted-foreground">{upgradeMsg}</p>
          </div>
          {upgrades.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3">Title</th>
                    <th className="py-2 pr-3">Upgrade release</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {upgrades.map(u => (
                    <tr key={u.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 text-foreground">{u.title ?? `item ${u.item_id}`}</td>
                      <td className="py-2 pr-3 text-muted-foreground truncate max-w-xs" title={u.new_release}>{u.new_release}</td>
                      <td className="py-2 pr-3">
                        <span className={
                          u.status === 'completed' ? 'text-green-400'
                          : u.status === 'failed' ? 'text-red-400'
                          : 'text-yellow-400'
                        }>{u.status}</span>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{relativeTime(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

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
                          onClick={() => handleGrab(item)}
                          disabled={item.tmdb_id == null}
                          title={item.tmdb_id == null ? 'No TMDB match — cannot open grab confirmation' : undefined}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" />Grab Now
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

      {/* Blocklist (Part 2) — hashes hard-gated out of every auto-grab. */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Ban className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            Blocklist {!loadingBlocklist && `(${blocklist.length})`}
          </h2>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          Releases here are never auto-grabbed. The reaper adds dead torrents automatically (stuck
          metadata with no peers, or a stalled/errored download), then re-searches the item for the
          next-best release; you can also block a hash by hand or remove one to allow it again.
        </p>

        {blockError && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {blockError}
            <button onClick={() => setBlockError('')} className="ml-3 underline text-xs">dismiss</button>
          </div>
        )}

        {/* Manual add */}
        <form onSubmit={e => void blockAdd(e)} className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={blockHash}
            onChange={e => setBlockHash(e.target.value)}
            placeholder="Info hash to block"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={blockTitle}
            onChange={e => setBlockTitle(e.target.value)}
            placeholder="Label (optional)"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={blockBusy}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {blockBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            Block
          </button>
        </form>

        {loadingBlocklist ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Info Hash', 'Title', 'Reason', 'Blocked', ''].map((h, i) => (
                    <th key={i} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {blocklist.map(row => (
                  <tr key={row.info_hash}>
                    <td className="px-4 py-2 font-mono text-xs text-foreground max-w-[12rem] truncate" title={row.info_hash}>
                      {row.info_hash}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground max-w-xs truncate" title={row.title ?? ''}>
                      {row.title ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.reason ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{relativeTime(row.blocked_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => void blockRemove(row.info_hash)}
                        className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Remove from blocklist (allow again)"
                        aria-label={`Unblock ${row.title ?? row.info_hash}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {blocklist.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Nothing blocklisted.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Import Lists — auto-add titles from Trakt/RSS as long-term monitored items. */}
      <ImportListsCard profiles={profiles} />

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
