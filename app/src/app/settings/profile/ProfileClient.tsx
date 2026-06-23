/**
 * Client component for /settings/profile.
 * Manages four independent save flows (demographics, display name, email,
 * password) each with their own status state rather than a single global
 * save to allow per-section feedback without blocking unrelated fields.
 * Session management (list + revoke) is handled by the nested SessionsSection.
 */
'use client'

import { useState, useEffect, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Deterministic hue from username so the same user always gets the same avatar color
function usernameToHue(username: string): number {
  let hash = 0
  for (const c of username) {
    // djb2-style hash; &0xffffffff keeps it 32-bit to avoid floating point drift
    hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  }
  return Math.abs(hash) % 360
}

function getInitials(displayName: string, username: string): string {
  const name = displayName.trim() || username
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function inferDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown'
  if (/Mobile/i.test(userAgent)) return 'Mobile'
  if (/Firefox/i.test(userAgent)) return 'Firefox'
  if (/Chrome/i.test(userAgent)) return 'Chrome'
  if (/Safari/i.test(userAgent)) return 'Safari'
  return 'Unknown'
}

// ---------------------------------------------------------------------------
// Password rule checker (mirrors validatePassword logic from password.ts)
// ---------------------------------------------------------------------------

// Must stay in sync with the server-side SPECIAL_CHARS list in src/lib/password.ts
const SPECIAL_CHARS = '!@#$%^&*()-_=+[]{}|;:,.<>?/~`\'"\\'.split('')

interface PwRules {
  length: boolean
  upper: boolean
  lower: boolean
  special: boolean
  noRepeat: boolean
  noForbidden: boolean
}

function checkPwRules(password: string, username: string): PwRules {
  return {
    length: password.length >= 8 && password.length <= 64,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    special: SPECIAL_CHARS.some((c) => password.includes(c)),
    noRepeat: !(/(.)\1{2,}/.test(password)),
    noForbidden:
      !password.toLowerCase().includes('password') &&
      !password.toLowerCase().includes('unified') &&
      !(username && password.toLowerCase().includes(username.toLowerCase())),
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
}

function RuleItem({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={`flex items-center gap-1.5 text-xs ${ok ? 'text-green-500' : 'text-muted-foreground'}`}>
      <span className="text-base leading-none">{ok ? '✓' : '○'}</span>
      {text}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Sessions section
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string
  ip_address: string | null
  user_agent: string | null
  created_at: number
  last_seen: number
  expires_at: number
}

function SessionsSection({ currentSessionId }: { currentSessionId: string }) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/profile/sessions')
      if (!res.ok) throw new Error('Failed to load sessions')
      const data = (await res.json()) as { sessions: SessionRow[] }
      setSessions(data.sessions)
    } catch {
      setError('Could not load sessions.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred a tick so load()'s loading setState runs outside the effect's
  // synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  async function revoke(id: string) {
    setRevoking(id)
    setError('')
    try {
      const res = await fetch(`/api/auth/profile/sessions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? 'Failed to revoke session')
      } else {
        setSessions((prev) => prev.filter((s) => s.id !== id))
      }
    } catch {
      setError('Network error')
    } finally {
      setRevoking(null)
    }
  }

  async function revokeOthers() {
    setRevokingAll(true)
    setError('')
    try {
      const res = await fetch('/api/auth/profile/sessions/revoke-others', { method: 'POST' })
      if (!res.ok) {
        setError('Failed to revoke sessions')
      } else {
        // Optimistically remove all non-current sessions from the list without a refetch
        setSessions((prev) => prev.filter((s) => s.id === currentSessionId))
      }
    } catch {
      setError('Network error')
    } finally {
      setRevokingAll(false)
    }
  }

  const otherCount = sessions.filter((s) => s.id !== currentSessionId).length

  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Active Sessions</h2>
        {otherCount > 0 && (
          <button
            onClick={() => void revokeOthers()}
            disabled={revokingAll}
            className="text-sm text-destructive hover:underline disabled:opacity-50"
          >
            {revokingAll ? 'Revoking…' : `Revoke all other sessions (${otherCount})`}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <div className="divide-y divide-border">
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId
            return (
              <div key={s.id} className="flex items-center justify-between py-3 gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{inferDevice(s.user_agent)}</span>
                    {isCurrent && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {s.ip_address ?? 'Unknown IP'} · Last seen {relativeTime(s.last_seen)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => void revoke(s.id)}
                  disabled={isCurrent || revoking === s.id}
                  className="flex-shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-destructive hover:text-destructive-foreground hover:border-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {revoking === s.id ? 'Revoking…' : isCurrent ? 'Current' : 'Revoke'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

interface Props {
  username: string
  email: string
  displayName: string
  firstName: string
  lastName: string
  bio: string
  location: string
  currentSessionId: string
}

export default function ProfileClient({
  username, email: initialEmail, displayName: initialDisplayName,
  firstName: initialFirstName, lastName: initialLastName,
  bio: initialBio, location: initialLocation,
  currentSessionId,
}: Props) {
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [bio, setBio] = useState(initialBio)
  const [location, setLocation] = useState(initialLocation)
  const [demoStatus, setDemoStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [demoError, setDemoError] = useState('')

  async function saveDemographics() {
    setDemoStatus('saving'); setDemoError('')
    try {
      const res = await fetch('/api/auth/profile/demographics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, bio, location }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setDemoError(d.error ?? 'Save failed'); setDemoStatus('error')
      } else {
        setDemoStatus('saved'); setTimeout(() => setDemoStatus('idle'), 2500)
      }
    } catch { setDemoError('Network error'); setDemoStatus('error') }
  }
  // Identity state
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [displayNameStatus, setDisplayNameStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [displayNameError, setDisplayNameError] = useState('')

  const [email, setEmail] = useState(initialEmail)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [emailError, setEmailError] = useState('')

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [pwError, setPwError] = useState('')
  const [pwErrors, setPwErrors] = useState<string[]>([])

  const pwRules = checkPwRules(newPassword, username)
  const hue = usernameToHue(username)
  const initials = getInitials(displayName, username)

  // ---------------------------------------------------------------------------
  // Identity saves
  // ---------------------------------------------------------------------------

  async function saveDisplayName() {
    setDisplayNameStatus('saving')
    setDisplayNameError('')
    try {
      const res = await fetch('/api/auth/profile/display-name', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setDisplayNameError(data.error ?? 'Save failed')
        setDisplayNameStatus('error')
      } else {
        setDisplayNameStatus('saved')
        setTimeout(() => setDisplayNameStatus('idle'), 2500)
      }
    } catch {
      setDisplayNameError('Network error')
      setDisplayNameStatus('error')
    }
  }

  async function saveEmail() {
    setEmailStatus('saving')
    setEmailError('')
    try {
      const res = await fetch('/api/auth/profile/email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setEmailError(data.error ?? 'Save failed')
        setEmailStatus('error')
      } else {
        setEmailStatus('saved')
        setTimeout(() => setEmailStatus('idle'), 2500)
      }
    } catch {
      setEmailError('Network error')
      setEmailStatus('error')
    }
  }

  // ---------------------------------------------------------------------------
  // Password save
  // ---------------------------------------------------------------------------

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwStatus('saving')
    setPwError('')
    setPwErrors([])

    try {
      const res = await fetch('/api/auth/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      const data = (await res.json()) as { error?: string; errors?: string[] }
      if (!res.ok) {
        if (data.errors) setPwErrors(data.errors)
        else setPwError(data.error ?? 'Save failed')
        setPwStatus('error')
      } else {
        setPwStatus('saved')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => setPwStatus('idle'), 3000)
      }
    } catch {
      setPwError('Network error')
      setPwStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Identity section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-6">
        <h2 className="text-lg font-semibold">Identity</h2>

        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div
            className="h-16 w-16 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
            style={{ background: `hsl(${hue}, 65%, 45%)` }}
          >
            {initials}
          </div>
          <div>
            <p className="font-medium">{username}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Your avatar is generated from your username</p>
          </div>
        </div>

        {/* Username (read-only) */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Username</label>
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground select-all">
            {username}
          </p>
        </div>

        {/* Display name */}
        <div className="flex flex-col gap-1">
          <label htmlFor="display-name" className="text-sm font-medium">Display Name</label>
          <div className="flex gap-2">
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              placeholder={username}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => void saveDisplayName()}
              disabled={displayNameStatus === 'saving'}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {displayNameStatus === 'saving' ? 'Saving…' : displayNameStatus === 'saved' ? 'Saved' : 'Save'}
            </button>
          </div>
          {displayNameError && <p className="text-xs text-destructive">{displayNameError}</p>}
          {displayNameStatus === 'saved' && <p className="text-xs text-green-500">Display name updated.</p>}
          <p className="text-xs text-muted-foreground">{displayName.length}/64</p>
        </div>

        {/* Email */}
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <div className="flex gap-2">
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => void saveEmail()}
              disabled={emailStatus === 'saving'}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {emailStatus === 'saving' ? 'Saving…' : emailStatus === 'saved' ? 'Saved' : 'Save'}
            </button>
          </div>
          {emailError && <p className="text-xs text-destructive">{emailError}</p>}
          {emailStatus === 'saved' && <p className="text-xs text-green-500">Email updated.</p>}
        </div>
      </section>

      {/* Change password section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Change Password</h2>
        <form onSubmit={(e) => void savePassword(e)} className="space-y-4">
          <PasswordInput
            id="current-password"
            label="Current Password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordInput
            id="new-password"
            label="New Password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />

          {/* Rule checklist — shows once user starts typing */}
          {newPassword.length > 0 && (
            <ul className="space-y-1 pl-1">
              <RuleItem ok={pwRules.length} text="At least 8 characters" />
              <RuleItem ok={pwRules.upper} text="At least one uppercase letter" />
              <RuleItem ok={pwRules.lower} text="At least one lowercase letter" />
              <RuleItem ok={pwRules.special} text="At least one special character" />
              <RuleItem ok={pwRules.noRepeat} text="No 3+ identical characters in a row" />
              <RuleItem ok={pwRules.noForbidden} text='Does not contain "password", "unified", or your username' />
            </ul>
          )}

          <PasswordInput
            id="confirm-password"
            label="Confirm New Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />

          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          )}

          {pwError && <p className="text-sm text-destructive">{pwError}</p>}
          {pwErrors.length > 0 && (
            <ul className="space-y-1">
              {pwErrors.map((e) => (
                <li key={e} className="text-xs text-destructive">{e}</li>
              ))}
            </ul>
          )}
          {pwStatus === 'saved' && (
            <p className="text-sm text-green-500">Password changed. All other sessions have been signed out.</p>
          )}

          <button
            type="submit"
            disabled={pwStatus === 'saving'}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {pwStatus === 'saving' ? 'Saving…' : 'Change Password'}
          </button>
        </form>
      </section>

      {/* Demographics section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">About Me</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="first-name" className="text-sm font-medium">First Name</label>
            <input id="first-name" type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
              maxLength={64} placeholder="Jane"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="last-name" className="text-sm font-medium">Last Name</label>
            <input id="last-name" type="text" value={lastName} onChange={e => setLastName(e.target.value)}
              maxLength={64} placeholder="Doe"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="location" className="text-sm font-medium">Location</label>
          <input id="location" type="text" value={location} onChange={e => setLocation(e.target.value)}
            maxLength={128} placeholder="City, State"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="bio" className="text-sm font-medium">Bio</label>
          <textarea id="bio" rows={3} value={bio} onChange={e => setBio(e.target.value)}
            maxLength={256} placeholder="A short bio…"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
          <p className="text-xs text-muted-foreground">{bio.length}/256</p>
        </div>
        {demoError && <p className="text-xs text-destructive">{demoError}</p>}
        {demoStatus === 'saved' && <p className="text-xs text-green-500">Profile updated.</p>}
        <button onClick={() => void saveDemographics()} disabled={demoStatus === 'saving'}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {demoStatus === 'saving' ? 'Saving…' : 'Save Profile'}
        </button>
      </section>

      {/* Sessions section */}
      <SessionsSection currentSessionId={currentSessionId} />
    </div>
  )
}
