'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, Check, X } from 'lucide-react'

function checkRules(password: string) {
  return {
    length: password.length >= 8 && password.length <= 64,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    special: /[!@#$%^&*()\-_=+\[\]{}|;:,.<>?/~`'"\\]/.test(password),
    noRepeat: !/(.)\1{2,}/.test(password),
    noBlockedWords: !password.toLowerCase().includes('password') && !password.toLowerCase().includes('unified'),
  }
}

export default function ChangePasswordPage() {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  const [success, setSuccess] = useState(false)

  const rules = checkRules(newPw)
  const allRulesPassed = Object.values(rules).every(Boolean)
  const passwordsMatch = newPw === confirm && confirm.length > 0
  const canSubmit = current.length > 0 && allRulesPassed && passwordsMatch

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setFieldErrors([])

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
      })
      const data = await res.json() as { error?: string; errors?: string[] }
      if (!res.ok) {
        if (data.errors) setFieldErrors(data.errors)
        else setError(data.error ?? 'Failed to change password.')
        return
      }
      setSuccess(true)
      setTimeout(() => router.push('/'), 1500)
    } catch {
      setError('An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Change Password</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose a new secure password</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-8">
          {success ? (
            <div className="text-center">
              <Check className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="text-foreground font-medium">Password changed successfully!</p>
              <p className="text-sm text-muted-foreground mt-1">Redirecting&hellip;</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Current Password</label>
                <div className="relative">
                  <input type={showCurrent ? 'text' : 'password'} required value={current} onChange={e => setCurrent(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                  <button type="button" onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
                <div className="relative">
                  <input type={showNew ? 'text' : 'password'} required value={newPw} onChange={e => setNewPw(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-4 py-2.5 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                  <button type="button" onClick={() => setShowNew(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPw.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {[
                      [rules.length, 'At least 8 characters'],
                      [rules.uppercase, 'At least one uppercase letter'],
                      [rules.lowercase, 'At least one lowercase letter'],
                      [rules.special, 'At least one special character'],
                      [rules.noRepeat, 'No 3+ identical characters in a row'],
                      [rules.noBlockedWords, 'Does not contain "password" or app name'],
                    ].map(([pass, label]) => (
                      <li key={label as string} className={`flex items-center gap-1.5 text-xs ${pass ? 'text-green-400' : 'text-red-400'}`}>
                        {pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {label as string}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Confirm New Password</label>
                <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                {confirm.length > 0 && (
                  <p className={`mt-1 text-xs ${passwordsMatch ? 'text-green-400' : 'text-red-400'}`}>
                    {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                  </p>
                )}
              </div>
              {(error || fieldErrors.length > 0) && (
                <div className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">
                  {error && <p>{error}</p>}
                  {fieldErrors.map(e => <p key={e}>{e}</p>)}
                </div>
              )}
              <button type="submit" disabled={!canSubmit || loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? 'Saving…' : 'Change Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
