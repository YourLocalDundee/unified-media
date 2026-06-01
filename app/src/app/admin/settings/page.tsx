'use client'

import { useEffect, useState } from 'react'

export default function AdminSettingsPage() {
  const [autoApprove, setAutoApprove] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        setAutoApprove(data.auto_approve === '1')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_approve: autoApprove ? '1' : '0' }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) {
    return <div className="animate-pulse h-4 w-48 rounded bg-muted" />
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Admin-level configuration for the unified app.</p>
      </div>

      {/* Request Settings */}
      <section className="rounded-xl border border-border bg-card p-6 space-y-6">
        <h2 className="text-base font-semibold">Request Settings</h2>

        {/* Auto-Approve Toggle */}
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <p className="text-sm font-medium">Auto-Approve Requests</p>
            <p className="mt-1 text-xs text-muted-foreground">
              When enabled, new requests are approved immediately without manual review.
              Disabled by default — requests go to the Requests queue for your approval.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoApprove}
            onClick={() => setAutoApprove((v) => !v)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
              autoApprove ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                autoApprove ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Future limits notice */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 space-y-1.5">
          <p className="font-semibold text-amber-200">Planned auto-approve limits (not yet enforced)</p>
          <ul className="list-disc list-inside space-y-1 text-amber-300/80">
            <li>TV shows: maximum 2 episodes auto-approved per request to control disk usage</li>
            <li>Movies: maximum 1 movie at a time</li>
            <li>Auto-approved content: scheduled for deletion after 24 hours to free space</li>
          </ul>
          <p className="pt-1 text-amber-400/60">
            These limits will be enforced in a future update once storage management and auto-deletion are implemented.
          </p>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {saved && <p className="text-sm text-green-400">Saved.</p>}
      </div>
    </div>
  )
}
