'use client'

/**
 * Login page — username/password form that hits /api/auth/login.
 *
 * After a successful login the context is refreshed so downstream components
 * (nav, profile) reflect the new session without a full page reload. Supports
 * the `?from=` open-redirect guard and the `requiresPasswordChange` server flag
 * that admin-created accounts emit on first login.
 *
 * No session cookie is read here — the browser sends it automatically on the
 * POST, and the API route sets it on success. Client state is updated via
 * AuthContext.refresh() so the context re-fetches /api/auth/me.
 */

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

// Validates the post-login redirect target to prevent open-redirect attacks.
// Blocks protocol-relative URLs (//evil.com), absolute URLs (contains ':'),
// and circular redirects back to auth pages. Mirrors src/lib/safe-redirect.ts
// but inlined here to avoid pulling a server-only module into a client component.
function getSafeRedirect(from: string | null): string {
  if (!from) return '/'
  if (!from.startsWith('/') || from.startsWith('//')) return '/'
  if (from.includes(':')) return '/'
  if (from.startsWith('/login') || from.startsWith('/register')) return '/'
  return from
}

function LoginForm() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refresh } = useAuth()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json() as { error?: string; requiresPasswordChange?: boolean; username?: string; role?: string }

      if (!res.ok) {
        // Surface distinct messages for rate-limit and suspended-account cases
        // without leaking whether the username itself exists.
        if (res.status === 429) setError('Too many attempts. Please wait before trying again.')
        else if (res.status === 403) setError('Your account has been suspended. Contact the site owner.')
        else setError(data.error ?? 'Invalid username or password.')
        return
      }

      // Admin-created accounts have force_pw_change set; the server returns this
      // flag instead of issuing a session cookie, so the user cannot skip the
      // password change by navigating away before the cookie lands.
      if (data.requiresPasswordChange) {
        router.push('/change-password')
        return
      }

      // Refresh context so the nav and any server components see the new session.
      await refresh()
      router.push(getSafeRedirect(searchParams.get('from')))
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Unified Media</h1>
          <p className="mt-2 text-sm text-muted-foreground">Watch anywhere. Your library, your way.</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-foreground mb-1.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="your_username"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 rounded-lg bg-red-400/10 px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 transition-colors"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <a
              href="/forgot"
              className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Forgot password?
            </a>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{' '}
          <a href="/register" className="text-primary hover:underline font-medium">
            Create an account &rarr;
          </a>
        </p>
      </div>
    </div>
  )
}

// Suspense is required because LoginForm calls useSearchParams(), which suspends
// during static rendering in Next.js 15. The boundary prevents the entire page
// from failing; the form becomes the only suspended subtree.
export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
