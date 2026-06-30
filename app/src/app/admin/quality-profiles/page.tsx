'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { QualityProfileFull, QualityTier, CustomFormatSpec } from '@/lib/automation/quality'
import type { QualityCondition } from '@/lib/automation/types'

type FormatEntry = { format_id: number; name: string; specs: string; score: number }

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
  function remove(i: number) {
    onChange(conditions.filter((_, idx) => idx !== i))
  }
  function update(i: number, patch: Partial<QualityCondition>) {
    const next = conditions.map((c, idx) => {
      if (idx !== i) return c
      const merged = { ...c, ...patch }
      // When type changes, reset value to the first option for that type
      if (patch.type && patch.type !== c.type) merged.value = COND_VALUES[patch.type][0]
      return merged
    })
    onChange(next)
  }

  const cell = 'text-xs text-zinc-300'
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
          <label className={`flex items-center gap-1 cursor-pointer ${cell}`}>
            <input type="checkbox" checked={c.required} onChange={e => update(i, { required: e.target.checked })} />
            Required
          </label>
          <label className={`flex items-center gap-1 cursor-pointer ${cell}`}>
            <input type="checkbox" checked={!!c.negate} onChange={e => update(i, { negate: e.target.checked })} />
            Exclude
          </label>
          <button onClick={() => remove(i)} className="ml-auto text-zinc-600 hover:text-red-400 text-xs px-1" title="Remove">✕</button>
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

interface ProfilesData {
  profiles: QualityProfileFull[]
  tiers: QualityTier[]
  formats: Array<{ id: number; name: string; specs: string }>
}

function formatBytes(b: number) {
  if (!b) return '0 B'
  const gb = b / 1024 / 1024 / 1024
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(b / 1024 / 1024).toFixed(0)} MB`
}

// ── Format score editor ───────────────────────────────────────────────────────

function FormatScoreRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: FormatEntry
  onChange: (score: number) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-zinc-800/60 last:border-0">
      <span className="flex-1 text-sm text-zinc-300">{entry.name}</span>
      <input
        type="number"
        value={entry.score}
        onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-20 rounded bg-zinc-800 px-2 py-1 text-sm text-white text-right outline-none focus:ring-1 focus:ring-white/20"
      />
      <button
        onClick={onRemove}
        className="text-zinc-600 hover:text-red-400 text-xs px-1"
        title="Remove from profile"
      >
        ✕
      </button>
    </div>
  )
}

// ── Add custom format modal ───────────────────────────────────────────────────

const SPEC_TYPES: CustomFormatSpec['type'][] = ['title_regex', 'resolution', 'source', 'codec', 'language', 'release_group', 'size', 'flag']

// Per-type hint shown in the value input so the admin knows the expected format.
const SPEC_VALUE_HINT: Record<CustomFormatSpec['type'], string> = {
  title_regex: 'regex pattern…',
  resolution: '1080p, 2160p…',
  source: 'web-dl, bluray…',
  codec: 'x265, x264…',
  language: 'ISO code: en, fr, ja…',
  release_group: 'scene group, e.g. NTb',
  size: 'GB range: 2-8, -25, 4-',
  flag: 'proper, repack, hdr, dv, atmos…',
}

function AddFormatModal({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (name: string, specs: CustomFormatSpec[]) => void
}) {
  const [name, setName] = useState('')
  const [specs, setSpecs] = useState<CustomFormatSpec[]>([{ type: 'title_regex', value: '', required: true, negate: false }])

  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, onClose)

  function addSpec() {
    setSpecs(s => [...s, { type: 'title_regex', value: '', required: true, negate: false }])
  }

  function updateSpec(i: number, patch: Partial<CustomFormatSpec>) {
    setSpecs(s => s.map((sp, idx) => idx === i ? { ...sp, ...patch } : sp))
  }

  function removeSpec(i: number) {
    setSpecs(s => s.filter((_, idx) => idx !== i))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-format-title"
        className="bg-zinc-900 rounded-xl border border-zinc-700 p-6 w-full max-w-lg mx-4"
      >
        <h3 id="add-format-title" className="text-lg font-semibold text-white mb-4">New Custom Format</h3>

        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/20"
            placeholder="e.g. Remux, 4K HDR, Proper"
          />
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-zinc-400">Conditions (all must match)</label>
            <button onClick={addSpec} className="text-xs text-zinc-400 hover:text-white">+ Add</button>
          </div>
          {specs.map((spec, i) => (
            <div key={i} className="flex gap-2 mb-2 items-start">
              <select
                value={spec.type}
                onChange={e => updateSpec(i, { type: e.target.value as CustomFormatSpec['type'] })}
                className="rounded bg-zinc-800 px-2 py-1.5 text-xs text-white outline-none"
              >
                {SPEC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                value={spec.value}
                onChange={e => updateSpec(i, { value: e.target.value })}
                placeholder={SPEC_VALUE_HINT[spec.type] ?? 'value…'}
                className="flex-1 rounded bg-zinc-800 px-2 py-1.5 text-xs text-white outline-none"
              />
              <label className="flex items-center gap-1 text-xs text-zinc-400 whitespace-nowrap">
                <input type="checkbox" checked={spec.negate} onChange={e => updateSpec(i, { negate: e.target.checked })} />
                NOT
              </label>
              <button onClick={() => removeSpec(i)} className="text-zinc-600 hover:text-red-400 text-xs px-1">✕</button>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700">
            Cancel
          </button>
          <button
            onClick={() => { if (name.trim()) { onAdd(name.trim(), specs); onClose() } }}
            disabled={!name.trim() || specs.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Add Format
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Profile editor ────────────────────────────────────────────────────────────

function ProfileEditor({
  profile,
  tiers,
  allFormats,
  onSaved,
  onDeleted,
}: {
  profile: QualityProfileFull
  tiers: QualityTier[]
  allFormats: Array<{ id: number; name: string; specs: string }>
  onSaved: (p: QualityProfileFull) => void
  onDeleted: (id: number) => void
}) {
  const [name, setName] = useState(profile.name)
  const [upgradeAllowed, setUpgradeAllowed] = useState(!!profile.upgrade_allowed)
  const [cutoffId, setCutoffId] = useState<number | null>(profile.cutoff_quality_id)
  const [minScore, setMinScore] = useState(profile.min_format_score)
  const [cutoffScore, setCutoffScore] = useState(profile.cutoff_format_score)
  const [language, setLanguage] = useState(profile.language ?? 'any')
  const [delayMinutes, setDelayMinutes] = useState(profile.delay_minutes ?? 0)
  const [formats, setFormats] = useState<FormatEntry[]>(profile.formats)
  const [conditions, setConditions] = useState<QualityCondition[]>(profile.conditions ?? [])
  const [busy, setBusy] = useState(false)
  const [showAddFormat, setShowAddFormat] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const attachedIds = new Set(formats.map(f => f.format_id))

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/quality-profiles/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          upgrade_allowed: upgradeAllowed,
          cutoff_quality_id: cutoffId,
          min_format_score: minScore,
          cutoff_format_score: cutoffScore,
          language,
          delay_minutes: delayMinutes,
          conditions,
          formats: formats.map(f => ({ format_id: f.format_id, score: f.score })),
        }),
      })
      if (!res.ok) { setMessage('Save failed.'); return }
      const updated = await res.json() as QualityProfileFull
      onSaved(updated)
      setMessage('Saved.')
    } finally {
      setBusy(false)
    }
  }

  async function handleNewFormat(fmtName: string, specs: CustomFormatSpec[]) {
    setBusy(true)
    try {
      const res = await fetch(`/api/quality-profiles/${profile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_format: { name: fmtName, specs } }),
      })
      if (!res.ok) return
      const updated = await res.json() as QualityProfileFull
      setFormats(updated.formats)
      onSaved(updated)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete profile "${name}"? This cannot be undone.`)) return
    setBusy(true)
    await fetch(`/api/quality-profiles/${profile.id}`, { method: 'DELETE' })
    onDeleted(profile.id)
  }

  function attachExistingFormat(fmt: { id: number; name: string; specs: string }) {
    if (attachedIds.has(fmt.id)) return
    setFormats(f => [...f, { format_id: fmt.id, name: fmt.name, specs: fmt.specs, score: 0 }])
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      {showAddFormat && (
        <AddFormatModal
          onClose={() => setShowAddFormat(false)}
          onAdd={handleNewFormat}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Profile Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/20"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Cutoff Quality Tier</label>
          <select
            value={cutoffId ?? ''}
            onChange={e => setCutoffId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
          >
            <option value="">None (any tier satisfies)</option>
            {tiers.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Min Custom Format Score</label>
          <input
            type="number"
            value={minScore}
            onChange={e => setMinScore(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Cutoff Format Score</label>
          <input
            type="number"
            value={cutoffScore}
            onChange={e => setCutoffScore(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Language Constraint</label>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
          >
            <option value="any">Any language (no constraint)</option>
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="es">Spanish</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
            <option value="nl">Dutch</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
            <option value="ko">Korean</option>
            <option value="ru">Russian</option>
          </select>
          <p className="mt-1 text-[10px] text-zinc-600">
            Hard constraint on auto-pick. &ldquo;Any&rdquo; is the safest choice — most English releases carry no language tag.
          </p>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Release delay (minutes)</label>
          <input
            type="number"
            min={0}
            value={delayMinutes}
            onChange={e => setDelayMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/20"
          />
          <p className="mt-1 text-[10px] text-zinc-600">
            0 = grab immediately. A release must be visible for this many minutes before auto-grab picks it up.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 mb-5 text-sm text-zinc-300">
        <input type="checkbox" checked={upgradeAllowed} onChange={e => setUpgradeAllowed(e.target.checked)} />
        Allow upgrades (grab a better release if one appears)
      </label>

      <div className="mb-5">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Conditions
        </span>
        <p className="mb-3 text-[10px] text-zinc-600">
          Required + Exclude = hard-reject matching releases. Required without Exclude = must match or skip.
          Non-required = preferred bonus (+10 score) but never rejects.
        </p>
        <ConditionEditor conditions={conditions} onChange={setConditions} />
      </div>

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Custom Formats &amp; Scores
          </span>
          <div className="flex gap-2">
            {allFormats.filter(f => !attachedIds.has(f.id)).length > 0 && (
              <select
                defaultValue=""
                onChange={e => {
                  const fmt = allFormats.find(f => String(f.id) === e.target.value)
                  if (fmt) attachExistingFormat(fmt)
                  e.target.value = ''
                }}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-white outline-none"
              >
                <option value="">+ Add existing…</option>
                {allFormats.filter(f => !attachedIds.has(f.id)).map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => setShowAddFormat(true)}
              className="rounded bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1 text-xs"
            >
              New format…
            </button>
          </div>
        </div>

        {formats.length === 0 ? (
          <p className="text-xs text-zinc-600 py-2">No custom formats attached. All releases score 0.</p>
        ) : (
          <div className="rounded border border-zinc-800">
            {formats.map((f) => (
              <FormatScoreRow
                key={f.format_id}
                entry={f}
                onChange={score => setFormats(prev => prev.map(x => x.format_id === f.format_id ? { ...x, score } : x))}
                onRemove={() => setFormats(prev => prev.filter(x => x.format_id !== f.format_id))}
              />
            ))}
          </div>
        )}
      </div>

      {message && <p className="mb-3 text-xs text-zinc-300 bg-zinc-800 rounded px-3 py-2">{message}</p>}

      <div className="flex items-center justify-between">
        <button
          onClick={handleDelete}
          disabled={busy}
          className="rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-400 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Delete Profile
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function QualityProfilesPage() {
  const [data, setData] = useState<ProfilesData | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/quality-profiles')
    const json = await res.json() as ProfilesData
    setData(json)
    if (!selectedId && json.profiles.length > 0) setSelectedId(json.profiles[0].id)
  }, [selectedId])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  async function createProfile() {
    if (!newName.trim()) return
    const res = await fetch('/api/quality-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (res.ok) {
      const { id } = await res.json() as { id: number }
      setNewName('')
      setCreating(false)
      await load()
      setSelectedId(id)
    }
  }

  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center text-zinc-500">
        Loading quality profiles…
      </div>
    )
  }

  const selectedProfile = data.profiles.find(p => p.id === selectedId) ?? null

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Quality Profiles</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Define quality tiers, custom format scoring, and upgrade rules for the grab engine.
          </p>
        </div>
        <button
          onClick={() => setCreating(c => !c)}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200 shrink-0"
        >
          New Profile
        </button>
      </div>

      {creating && (
        <div className="mb-4 flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void createProfile()}
            placeholder="Profile name…"
            className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/20"
            autoFocus
          />
          <button
            onClick={() => void createProfile()}
            disabled={!newName.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Create
          </button>
          <button
            onClick={() => { setCreating(false); setNewName('') }}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex gap-1 flex-wrap mb-6">
        {data.profiles.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedId === p.id ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {selectedProfile ? (
        <ProfileEditor
          key={selectedProfile.id}
          profile={selectedProfile}
          tiers={data.tiers}
          allFormats={data.formats}
          onSaved={updated => {
            setData(d => d ? {
              ...d,
              profiles: d.profiles.map(p => p.id === updated.id ? updated : p),
            } : d)
          }}
          onDeleted={id => {
            setData(d => d ? { ...d, profiles: d.profiles.filter(p => p.id !== id) } : d)
            setSelectedId(null)
          }}
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500">
          {data.profiles.length === 0 ? 'No profiles. Create one above.' : 'Select a profile to edit.'}
        </div>
      )}

      {data.tiers.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3">Quality Tier Reference</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900">
                  <th className="py-2 pl-4 pr-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">Tier</th>
                  <th className="py-2 px-3 text-xs text-zinc-500 font-medium uppercase tracking-wide text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map(t => (
                  <tr key={t.id} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                    <td className="py-2 pl-4 pr-3 text-zinc-300">{t.label}</td>
                    <td className="py-2 px-3 text-right text-zinc-500">{t.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
