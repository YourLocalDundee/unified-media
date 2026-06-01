'use client'

import { useState } from 'react'
import { Loader2, Mail, CheckCircle2 } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      // Always show success — never reveal whether email exists
      setSent(true)
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Reset Password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {sent ? 'Check your email for a reset link.' : "Enter your email and we'll send you a reset link."}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle2 className="h-7 w-7 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-foreground font-medium">Reset link sent</p>
                <p className="text-xs text-muted-foreground mt-1">
                  If <strong>{email}</strong> is registered, a reset link will arrive within a few minutes. Check your spam folder.
                </p>
                <p className="text-xs text-yellow-400 mt-2">No SMTP configured? Check Docker logs for the link.</p>
              </div>
              <a href="/login" className="block text-sm text-primary hover:underline">&larr; Back to sign in</a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="you@example.com" />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</div>
              )}

              <button type="submit" disabled={loading || !email}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>

              <p className="text-center text-sm text-muted-foreground">
                <a href="/login" className="text-primary hover:underline">&larr; Back to sign in</a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
