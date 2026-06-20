'use client'

import { useState, useEffect, useCallback } from 'react'
import type { QualityProfileFull } from '@/lib/automation/quality'
import type { QualityCondition } from '@/lib/automation/types'

// ---------------------------------------------------------------------------
// Condition builder (mirrors admin quality-profiles page)
// ---------------------------------------------------------------------------

type CondType = QualityCondition['type']
const COND_TYPES: CondType[] = ['resolution', 'source', 'codec']
const COND_VALUES: Record<CondType, string[]> = {
  resolution: ['480p', '576p', '720p', '1080p', '2160p'],
  source:     ['BluRay', 'BluRay REMUX', 'WEB-DL', 'WEBRip', 'HDTV', 'DVDRip', 'CAM', 'TS'],
  codec:      ['x264', 'x265', 'xvid', 'divx'],
}

function ConditionEditor({
  conditions,
  onChange,
}: {
  conditions: QualityCondition[]
  onChange: (c: QualityCondition[]) => void
}) {
  function add() {
    onChange([...conditions, { type: 'resolution', value: '1080p', required: false, negate: false }])
  }
  function remove(i: number) { onChange(conditions.filter((_, idx) => idx !== i)) }
  function update(i: number, patch: Partial<QualityCondition>) {
    onChange(conditions.map((c, idx) => {
      if (idx !== i) return c
      const next = { ...c, ...patch }
      if (patch.type && patch.type !== c.type) next.value = COND_VALUES[patch.type][0]
      return next
    }))
  }

  const sel = 'rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-200 focus:outline-none'

  return (
    <div className="space-y-2">
      {conditions.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2">
          <select value={c.type} onChange={e => update(i, { type: e.target.value as CondType })} className={sel}>
            {COND_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={c.value} onChange={e => update(i, { value: e.target.value })} className={sel}>
            {COND_VALUES[c.type].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <label className="flex items-center gap-1 cursor-pointer text-xs text-zinc-300">
            <input type="checkbox" checked={c.required} onChange={e => update(i, { required: e.target.checked })} />
            Required
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-xs text-zinc-300">
            <input type="checkbox" checked={!!c.negate} onChange={e => update(i, { negate: e.target.checked })} />
            Exclude
          </label>
          <button onClick={() => remove(i)} className="ml-auto text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
        </div>
      ))}
      <button
        onClick={add}
        className="rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
      >
        + Add condition
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile form (create or edit)
// ---------------------------------------------------------------------------

function ProfileForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; conditions: QualityCondition[] }
  onSave: (name: string, conditions: QualityCondition[]) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [conditions, setConditions] = useState<QualityCondition[]>(initial?.conditions ?? [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return }
    setBusy(true)
    setErr('')
    try { await onSave(name.trim(), conditions) }
    catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Profile name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. My 1080p WEB-DL"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">
          Conditions — Required + Exclude = hard-reject. Required = must match. Not required = scoring bonus.
        </p>
        <ConditionEditor conditions={conditions} onChange={setConditions} />
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface ProfilesResponse {
  profiles: QualityProfileFull[]
  defaultProfileId: number | null
}

function conditionSummary(conditions: QualityCondition[]): string {
  if (conditions.length === 0) return 'Any release'
  return conditions.map(c => {
    const prefix = c.required ? (c.negate ? '✕ ' : '✓ ') : '~ '
    return `${prefix}${c.value}`
  }).join(' · ')
}

export default function QualitySettingsPage() {
  const [data, setData] = useState<ProfilesResponse | null>(null)
  const [defaultId, setDefaultId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savingDefault, setSavingDefault] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/automation/profiles')
    if (!res.ok) return
    const d = await res.json() as ProfilesResponse
    setData(d)
    setDefaultId(d.defaultProfileId)
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(name: string, conditions: QualityCondition[]) {
    const res = await fetch('/api/automation/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, conditions }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(d.error ?? 'Failed to create profile')
    }
    setCreating(false)
    await load()
  }

  async function handleUpdate(id: number, name: string, conditions: QualityCondition[]) {
    const res = await fetch(`/api/quality-profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, conditions }),
    })
    if (!res.ok) throw new Error('Save failed')
    setEditingId(null)
    await load()
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete profile "${name}"?`)) return
    await fetch(`/api/quality-profiles/${id}`, { method: 'DELETE' })
    if (defaultId === id) await setDefaultProfile(null)
    await load()
  }

  async function setDefaultProfile(id: number | null) {
    setSavingDefault(true)
    setMsg('')
    try {
      const res = await fetch('/api/auth/profile/default-quality-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setDefaultId(id)
      setMsg('Default saved.')
      setTimeout(() => setMsg(''), 2500)
    } catch { setMsg('Failed to save default.') }
    finally { setSavingDefault(false) }
  }

  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>

  const sharedProfiles = data.profiles.filter(p => p.user_id === null)
  const myProfiles = data.profiles.filter(p => p.user_id !== null)

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-1">Quality Profiles</h2>
        <p className="text-sm text-muted-foreground">
          Set a default profile that pre-fills the quality selector when you request content. You can also build your own profiles.
        </p>
      </div>

      {/* Default selector */}
      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold">Default Profile</h3>
        <p className="text-xs text-muted-foreground">
          Pre-selected in the request options on the browse page. You can still override per-request.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={defaultId ?? ''}
            onChange={e => void setDefaultProfile(e.target.value ? Number(e.target.value) : null)}
            disabled={savingDefault}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary flex-1"
          >
            <option value="">None (choose per request)</option>
            {sharedProfiles.length > 0 && (
              <optgroup label="Shared">
                {sharedProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            )}
            {myProfiles.length > 0 && (
              <optgroup label="My Profiles">
                {myProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            )}
          </select>
          {msg && <span className="text-xs text-green-400">{msg}</span>}
        </div>
      </section>

      {/* My profiles */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">My Profiles</h3>
          {!creating && (
            <button
              onClick={() => { setCreating(true); setEditingId(null) }}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              + New Profile
            </button>
          )}
        </div>

        {creating && (
          <ProfileForm onSave={handleCreate} onCancel={() => setCreating(false)} />
        )}

        {myProfiles.length === 0 && !creating && (
          <p className="text-sm text-muted-foreground">No custom profiles yet.</p>
        )}

        {myProfiles.map(p => (
          <div key={p.id}>
            {editingId === p.id ? (
              <ProfileForm
                initial={{ name: p.name, conditions: p.conditions }}
                onSave={(name, conditions) => handleUpdate(p.id, name, conditions)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {p.name}
                    {defaultId === p.id && (
                      <span className="text-xs rounded-full px-2 py-0.5 bg-primary/20 text-primary border border-primary/30">Default</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{conditionSummary(p.conditions)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => { setEditingId(p.id); setCreating(false) }}
                    className="rounded px-2 py-1 text-xs hover:bg-muted text-muted-foreground"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void handleDelete(p.id, p.name)}
                    className="rounded px-2 py-1 text-xs hover:bg-red-500/10 text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
