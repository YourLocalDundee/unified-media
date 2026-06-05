'use client'

/**
 * Reset-password page — accepts the `?token=` query param from the emailed
 * link and lets the user set a new password via POST /api/auth/reset-password.
 *
 * The token is passed to the server for SHA-256 comparison against the stored
 * hash. On success, all sessions for the user are revoked so any stolen session
 * cannot persist after a credential reset.
 *
 * Missing or absent token redirects immediately to /forgot so the user can
 * restart the flow rather than seeing a confusing empty form.
 */

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Eye, EyeOff, Check, X, CheckCircle2 } from 'lucide-react'

function checkRules(password: string) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    special: /[!@#$%^&*()\-_=+\[\]{}|;:,.<>?/~`'"\\]/.test(password),
    noRepeat: !/(.)\1{2,}/.test(password),
  }
}

function ResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])

  // replace() rather than push() so the token-less URL is not in history;
  // hitting Back after being redirected to /forgot won't loop back here.
  useEffect(() => {
    if (!token) router.replace('/forgot')
  }, [token, router])

  const rules = checkRules(password)
  const allRules = Object.values(rules).every(Boolean)
  const matches = password === confirmPassword && confirmPassword.length > 0
  const canSubmit = allRules && matches

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setFieldErrors([])
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      })
      const data = await res.json() as { error?: string; errors?: string[] }
      if (!res.ok) {
        if (data.errors) setFieldErrors(data.errors)
        else setError(data.error ?? 'Reset failed.')
        return
      }
      setDone(true)
    } catch {
      setError('An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle2 className="h-7 w-7 text-green-400" />
        </div>
        <div>
          <p className="font-medium text-foreground">Password reset successfully</p>
          <p className="text-xs text-muted-foreground mt-1">All other sessions have been signed out.</p>
        </div>
        <button onClick={() => router.push('/login')}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
          Sign in with new password
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
        <div className="relative">
          <input type={showPw ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="••••••••" autoFocus />
          <button type="button" onClick={() => setShowPw(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {password.length > 0 && (
          <ul className="mt-2 space-y-1">
            {([
              [rules.length, 'At least 8 characters'],
              [rules.uppercase, 'Uppercase letter'],
              [rules.lowercase, 'Lowercase letter'],
              [rules.special, 'Special character'],
              [rules.noRepeat, 'No 3+ identical chars in a row'],
            ] as [boolean, string][]).map(([pass, label]) => (
              <li key={label} className={`flex items-center gap-1.5 text-xs ${pass ? 'text-green-400' : 'text-red-400'}`}>
                {pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Confirm New Password</label>
        <div className="relative">
          <input type={showConfirm ? 'text' : 'password'} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="••••••••" />
          <button type="button" onClick={() => setShowConfirm(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {confirmPassword.length > 0 && (
          <p className={`mt-1 text-xs ${matches ? 'text-green-400' : 'text-red-400'}`}>
            {matches ? 'Passwords match' : 'Passwords do not match'}
          </p>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</div>}
      {fieldErrors.map(e => <p key={e} className="text-sm text-red-400">{e}</p>)}

      <button type="submit" disabled={!canSubmit || loading}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? 'Resetting…' : 'Set New Password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Set New Password</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose a strong password for your account.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          {/* Suspense required because ResetForm calls useSearchParams() */}
          <Suspense fallback={<Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />}>
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
