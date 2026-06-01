'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Trash2, Pencil, FlaskConical } from 'lucide-react'

interface Indexer {
  id: number
  name: string
  torznab_url: string
  api_key: string
  enabled: number
  last_health_check: number | null
  health_status: string | null
}

interface TestResult {
  status: 'ok' | 'error'
  responseTimeMs: number
  errorMessage?: string
}

interface FormState {
  name: string
  torznab_url: string
  api_key: string
}

const EMPTY_FORM: FormState = { name: '', torznab_url: '', api_key: '' }

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function HealthBadge({ status, lastCheck }: { status: string | null; lastCheck: number | null }) {
  if (status === 'ok') {
    return (
      <span className="flex items-center gap-1.5 text-sm">
        <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
        <span className="text-green-500 font-medium">OK</span>
        {lastCheck !== null && (
          <span className="text-muted-foreground text-xs">({relativeTime(lastCheck)})</span>
        )}
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-sm">
        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
        <span className="text-red-400 font-medium">Error</span>
        {lastCheck !== null && (
          <span className="text-muted-foreground text-xs">({relativeTime(lastCheck)})</span>
        )}
      </span>
    )
  }
  return <span className="text-muted-foreground text-sm">—</span>
}

export default function AdminIndexersPage() {
  const [indexers, setIndexers] = useState<Indexer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Partial<FormState>>({})
  const [submitting, setSubmitting] = useState(false)

  // per-row test state: id → 'testing' | result
  const [testState, setTestState] = useState<Record<number, 'testing' | TestResult>>({})

  // per-row toggle loading
  const [toggling, setToggling] = useState<Set<number>>(new Set())

  const fetchIndexers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/indexer')
      if (!res.ok) throw new Error(`Failed to load indexers (${res.status})`)
      setIndexers(await res.json() as Indexer[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchIndexers() }, [fetchIndexers])

  function openAddModal() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModalOpen(true)
  }

  function openEditModal(indexer: Indexer) {
    setEditingId(indexer.id)
    setForm({ name: indexer.name, torznab_url: indexer.torznab_url, api_key: indexer.api_key })
    setFormErrors({})
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
  }

  function validateForm(): boolean {
    const errs: Partial<FormState> = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    if (!form.torznab_url.trim()) errs.torznab_url = 'Torznab URL is required'
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateForm()) return
    setSubmitting(true)
    setError(null)
    try {
      const body = { name: form.name.trim(), torznab_url: form.torznab_url.trim(), api_key: form.api_key.trim() }
      const res = editingId !== null
        ? await fetch(`/api/indexer/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/indexer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText)
        throw new Error(msg || `Request failed (${res.status})`)
      }
      closeModal()
      void fetchIndexers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!window.confirm(`Delete indexer "${name}"? This cannot be undone.`)) return
    setError(null)
    try {
      const res = await fetch(`/api/indexer/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      void fetchIndexers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  async function handleToggleEnabled(indexer: Indexer) {
    if (toggling.has(indexer.id)) return
    setToggling(prev => new Set(prev).add(indexer.id))
    setError(null)
    try {
      const res = await fetch(`/api/indexer/${indexer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: indexer.enabled === 1 ? 0 : 1 }),
      })
      if (!res.ok) throw new Error(`Toggle failed (${res.status})`)
      void fetchIndexers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(indexer.id); return s })
    }
  }

  async function handleTest(id: number) {
    setTestState(prev => ({ ...prev, [id]: 'testing' }))
    setError(null)
    try {
      const res = await fetch(`/api/indexer/${id}/test`, { method: 'POST' })
      const data = await res.json() as TestResult
      setTestState(prev => ({ ...prev, [id]: data }))
      // also refresh list so health_status column updates
      void fetchIndexers()
    } catch (e) {
      setTestState(prev => ({
        ...prev,
        [id]: { status: 'error', responseTimeMs: 0, errorMessage: e instanceof Error ? e.message : 'Network error' },
      }))
    }
  }

  return (
    <div className="space-y-8">
      {/* Global error banner */}
      {error && (
        <div className="rounded-lg bg-red-500/15 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Indexers</h1>
        <button
          onClick={openAddModal}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Add Indexer
        </button>
      </div>

      {/* Table */}
      <section>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Name', 'URL', 'Status', 'Enabled', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {indexers.map(row => {
                  const rowTest = testState[row.id]
                  const isTesting = rowTest === 'testing'
                  const testResult = rowTest && rowTest !== 'testing' ? rowTest : null

                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs">
                        <span className="truncate block font-mono text-xs" title={row.torznab_url}>
                          {row.torznab_url}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {testResult ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${testResult.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                            {testResult.status === 'ok' ? (
                              <span className="text-green-500 font-medium">OK <span className="text-muted-foreground font-normal text-xs">({testResult.responseTimeMs}ms)</span></span>
                            ) : (
                              <span className="text-red-400 font-medium" title={testResult.errorMessage}>Error</span>
                            )}
                          </span>
                        ) : (
                          <HealthBadge status={row.health_status} lastCheck={row.last_health_check} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void handleToggleEnabled(row)}
                          disabled={toggling.has(row.id)}
                          aria-label={row.enabled === 1 ? 'Disable indexer' : 'Enable indexer'}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
                            row.enabled === 1 ? 'bg-primary' : 'bg-muted'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              row.enabled === 1 ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {/* Test */}
                          <button
                            onClick={() => void handleTest(row.id)}
                            disabled={isTesting}
                            title="Test indexer"
                            className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                          >
                            {isTesting
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <FlaskConical className="h-3 w-3" />}
                            Test
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => openEditModal(row)}
                            title="Edit indexer"
                            className="rounded p-1 hover:bg-muted"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => void handleDelete(row.id, row.name)}
                            title="Delete indexer"
                            className="rounded p-1 hover:bg-red-500/20 text-red-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {indexers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No indexers configured. Add one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add / Edit modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl mx-4">
            <h2 className="text-lg font-semibold mb-5">
              {editingId !== null ? 'Edit Indexer' : 'Add Indexer'}
            </h2>

            <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Jackett All"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {formErrors.name && (
                  <p className="mt-1 text-xs text-red-400">{formErrors.name}</p>
                )}
              </div>

              {/* Torznab URL */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Torznab URL <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.torznab_url}
                  onChange={e => setForm(f => ({ ...f, torznab_url: e.target.value }))}
                  placeholder="http://jackett:9117/api/v2.0/indexers/all/results/torznab/"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
                {formErrors.torznab_url && (
                  <p className="mt-1 text-xs text-red-400">{formErrors.torznab_url}</p>
                )}
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">API Key</label>
                <input
                  value={form.api_key}
                  onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
                  placeholder="leave blank if not required"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingId !== null ? 'Save' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
