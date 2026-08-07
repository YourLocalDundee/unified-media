// Admin invite management — generate single-use or multi-use invite codes with
// optional expiry. Registration no longer requires an invite by default (v0.5.3+),
// but admins can still hand out invite links for controlled onboarding.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Copy, Loader2, Trash2 } from 'lucide-react'

interface Invite {
  code: string; label: string | null; created_at: number; expires_at: number | null;
  max_uses: number; use_count: number; used_by: string | null; used_at: number | null
}

export default function AdminInvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [expires, setExpires] = useState('never')
  const [creating, setCreating] = useState(false)
  const [newInviteUrl, setNewInviteUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/invites')
      if (res.ok) setInvites(await res.json() as Invite[])
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred a tick so fetchInvites' loading setState runs outside the effect's
  // synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => void fetchInvites(), 0)
    return () => clearTimeout(id)
  }, [fetchInvites])

  async function createInvite(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const expiresAt = expires === 'never' ? null :
        expires === '24h' ? Date.now() + 86400000 :
        expires === '7d' ? Date.now() + 7 * 86400000 :
        Date.now() + 30 * 86400000

      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label || null, maxUses: Number(maxUses), expiresAt }),
      })
      if (res.ok) {
        const data = await res.json() as { code: string }
        setNewInviteUrl(`${window.location.origin}/invite/${data.code}`)
        setLabel('')
        void fetchInvites()
      }
    } finally {
      setCreating(false)
    }
  }

  async function revokeInvite(code: string) {
    await fetch(`/api/admin/invites/${code}`, { method: 'DELETE' })
    void fetchInvites()
  }

  function copyUrl() {
    void navigator.clipboard.writeText(newInviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // "Active" includes unlimited-use codes that have been used but aren't exhausted.
  const active = invites.filter(i => !i.used_at || (i.max_uses === 0 || i.use_count < i.max_uses))
  const used = invites.filter(i => i.use_count > 0)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-foreground">Invites</h1>

      {/* Create form */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Generate Invite</h2>
        <form onSubmit={createInvite} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Label (optional)</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. for my brother John"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Max Uses</label>
            <select value={maxUses} onChange={e => setMaxUses(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none">
              <option value="1">1</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="0">Unlimited</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Expires</label>
            <select value={expires} onChange={e => setExpires(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none">
              <option value="never">Never</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>
          <button type="submit" disabled={creating}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            Generate Invite
          </button>
        </form>

        {newInviteUrl && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-background p-3">
            <code className="flex-1 text-sm font-mono break-all text-primary">{newInviteUrl}</code>
            <button onClick={copyUrl}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs bg-muted hover:bg-muted/80 shrink-0">
              <Copy className="h-3 w-3" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}
      </section>

      {/* Active invites */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Active Invites ({active.length})</h2>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Code', 'Label', 'Created', 'Expires', 'Uses', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {active.map(inv => (
                  <tr key={inv.code}>
                    <td className="px-4 py-2 font-mono text-xs">{inv.code}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.label ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : 'Never'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.use_count} / {inv.max_uses === 0 ? '∞' : inv.max_uses}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.code}`) }}
                          className="rounded p-1 hover:bg-muted"><Copy className="h-3 w-3" /></button>
                        <button onClick={() => void revokeInvite(inv.code)}
                          className="rounded p-1 hover:bg-red-500/20 text-red-400"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {active.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No active invites</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Used invites summary */}
      {used.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Used Invites ({used.length})</h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Code', 'Label', 'Uses', 'Created'].map(h => (
                    <th key={h} className="px-4 py-2 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {used.map(inv => (
                  <tr key={inv.code} className="opacity-60">
                    <td className="px-4 py-2 font-mono text-xs">{inv.code}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.label ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.use_count} / {inv.max_uses === 0 ? '∞' : inv.max_uses}</td>
                    <td className="px-4 py-2 text-muted-foreground">{new Date(inv.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
