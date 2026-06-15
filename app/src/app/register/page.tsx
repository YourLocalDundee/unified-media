'use client'

/**
 * Registration page — two-step flow: account info → email verification.
 *
 * Step 1 (StepOne): collects username/email/password + optional demographics,
 *   submits to POST /api/auth/register, which creates a pending_registrations
 *   row and emails a 6-digit code. Returns a `pendingId` opaque token.
 *
 * Step 2 (StepTwo): user enters the 6-digit code. POST /api/auth/verify-email
 *   validates it and, on success, creates the real user + session in one
 *   transaction. The `pendingId` is the only link between the two steps.
 *
 * No user row or session exists until Step 2 succeeds, so an abandoned Step 1
 * leaves no orphan accounts — only an expiring pending_registrations record.
 */

import { useState, useEffect, useRef, Suspense, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, Check, X, Mail } from 'lucide-react'

// Client-side password rules mirror the server-side validatePassword() in
// src/lib/password.ts so feedback is instant without a round-trip. The server
// re-validates regardless — this is UX only, not a security gate.
function checkRules(password: string, username: string) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    special: /[!@#$%^&*()\-_=+\[\]{}|;:,.<>?/~`'"\\]/.test(password),
    noRepeat: !/(.)\1{2,}/.test(password),
    // 'unified' is the app name; blocking it prevents trivially guessable passwords.
    noBlockedWords: !password.toLowerCase().includes('password') && !password.toLowerCase().includes('unified'),
  }
}

// ─── Step 1: Account info + demographics ─────────────────────────────────────

function StepOne({ onNext, onDone, verificationRequired }: {
  onNext: (pendingId: string, email: string) => void
  onDone: () => void
  verificationRequired: boolean | null
}) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [location, setLocation] = useState('')
  const [bio, setBio] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<string[]>([])
  // Distinct from `error`: a duplicate-email conflict gets a dedicated actionable
  // callout (sign-in link + reset stub) rather than a plain red string.
  const [emailExists, setEmailExists] = useState(false)
  const [showResetNote, setShowResetNote] = useState(false)
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [strength, setStrength] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rules = checkRules(password, username)
  const allRulesPassed = Object.values(rules).every(Boolean)
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  // strength === -1 means zxcvbn hasn't loaded yet; allow submit in that case
  // rather than blocking forever on a dynamic import failure or slow network.
  // score >= 2 ("Fair") is the minimum accepted; "Weak" (0–1) is blocked.
  const canSubmit = allRulesPassed && passwordsMatch && (strength === -1 || strength >= 2) &&
    usernameStatus === 'available' && emailValid

  // zxcvbn is large (~800 KB), so it is loaded lazily only once the user starts
  // typing a password. The username and common words are passed as user-inputs so
  // zxcvbn penalises them in the entropy estimate.
  useEffect(() => {
    if (!password) { setStrength(-1); return }
    void (async () => {
      try {
        const z = (await import('zxcvbn')).default
        setStrength((z(password, [username, 'unified', 'media']) as { score: number }).score)
      } catch { setStrength(-1) }
    })()
  }, [password, username])

  // Debounced live availability check — fires 500ms after the user stops typing.
  // Checks both users and pending_registrations so a username mid-verification
  // elsewhere is not simultaneously offered here. The server re-checks at
  // verify-email time anyway, so this is a UX hint, not the enforcement point.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) { setUsernameStatus('idle'); return }
    setUsernameStatus('checking')
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`)
        const d = await res.json() as { available: boolean }
        setUsernameStatus(d.available ? 'available' : 'taken')
      } catch { setUsernameStatus('idle') }
    }, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [username])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setFieldErrors([]); setEmailExists(false); setShowResetNote(false)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, confirmPassword, firstName, lastName, bio, location }),
      })
      const data = await res.json() as { error?: string; errors?: string[]; code?: string; pendingId?: string; username?: string }
      if (!res.ok) {
        // Duplicate email gets a dedicated, actionable callout (rendered below).
        if (data.code === 'EMAIL_EXISTS') { setEmailExists(true); return }
        if (data.errors) setFieldErrors(data.errors)
        else setError(data.error ?? 'Registration failed.')
        return
      }
      // When verification is disabled the server returns { username, role }
      // directly and sets the session cookie — redirect immediately.
      if (data.username) { onDone(); return }
      onNext(data.pendingId!, email)
    } catch {
      setError('An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  // zxcvbn scores run 0–4; index 0 and 1 both map to "Weak" intentionally.
  const strengthLabels = ['Weak', 'Weak', 'Fair', 'Good', 'Strong']
  const strengthColors = ['bg-red-500', 'bg-red-500', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500']

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</p>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Username <span className="text-red-400">*</span></label>
          <div className="relative">
            <input type="text" required value={username} onChange={e => setUsername(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="your_username" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {usernameStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {usernameStatus === 'available' && <Check className="h-4 w-4 text-green-500" />}
              {usernameStatus === 'taken' && <X className="h-4 w-4 text-red-400" />}
            </span>
          </div>
          {usernameStatus === 'taken' && <p className="mt-1 text-xs text-red-400">Username already taken</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Email <span className="text-red-400">*</span></label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="you@example.com" />
          {verificationRequired && (
            <p className="mt-1 text-xs text-muted-foreground">A 6-digit verification code will be sent here.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Password <span className="text-red-400">*</span></label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="••••••••" />
            <button type="button" onClick={() => setShowPassword(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {password.length > 0 && (
            <>
              <div className="mt-2 flex gap-1">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full ${strength >= 0 && i <= strength ? strengthColors[Math.min(strength, 4)] : 'bg-muted'}`} />
                ))}
              </div>
              {strength >= 0 && <p className="mt-1 text-xs text-muted-foreground">{strengthLabels[Math.min(strength, 4)]}</p>}
              <ul className="mt-2 space-y-1">
                {([
                  [rules.length, 'At least 8 characters'],
                  [rules.uppercase, 'Uppercase letter (A–Z)'],
                  [rules.lowercase, 'Lowercase letter (a–z)'],
                  [rules.special, 'Special character'],
                  [rules.noRepeat, 'No 3+ identical chars in a row'],
                  [rules.noBlockedWords, 'No common blocked words'],
                ] as [boolean, string][]).map(([pass, label]) => (
                  <li key={label} className={`flex items-center gap-1.5 text-xs ${pass ? 'text-green-400' : 'text-red-400'}`}>
                    {pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {label}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Confirm Password <span className="text-red-400">*</span></label>
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
            <p className={`mt-1 text-xs ${passwordsMatch ? 'text-green-400' : 'text-red-400'}`}>
              {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
            </p>
          )}
        </div>
      </div>

      {/* Demographics */}
      <div className="space-y-4 pt-2 border-t border-border">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-1">
          Profile <span className="font-normal normal-case">(optional)</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">First Name</label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Jane" maxLength={64} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Last Name</label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Doe" maxLength={64} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Location</label>
          <input type="text" value={location} onChange={e => setLocation(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="City, State" maxLength={128} />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Bio</label>
          <textarea value={bio} onChange={e => setBio(e.target.value)} rows={2}
            className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="A short bio…" maxLength={256} />
        </div>
      </div>

      {emailExists && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-3 text-sm">
          <p className="font-medium text-amber-300">This email is already registered.</p>
          <p className="mt-1 text-amber-200/80">
            You already have an account.{' '}
            <a href="/login" className="font-medium underline hover:text-amber-100">Sign in instead</a>.
          </p>
          <p className="mt-1.5 text-xs text-amber-200/70">
            Forgot your password?{' '}
            <button
              type="button"
              onClick={() => setShowResetNote(true)}
              className="underline hover:text-amber-100"
            >
              Reset password
            </button>
            {showResetNote && (
              <span className="mt-1 block text-amber-200/60">
                Password reset isn’t available yet — please contact the administrator to recover this account.
              </span>
            )}
          </p>
        </div>
      )}

      {(error || fieldErrors.length > 0) && (
        <div className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">
          {error && <p>{error}</p>}
          {fieldErrors.map(e => <p key={e}>{e}</p>)}
        </div>
      )}

      <button type="submit" disabled={!canSubmit || loading}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading
          ? (verificationRequired ? 'Sending verification code…' : 'Creating account…')
          : (verificationRequired ? 'Continue' : 'Create Account')}
      </button>
    </form>
  )
}

// ─── Step 2: Verification code entry ─────────────────────────────────────────

// ─── Step 2: Verification code entry ─────────────────────────────────────────

function StepTwo({ pendingId, email, onBack }: { pendingId: string; email: string; onBack: () => void }) {
  const router = useRouter()
  // Six separate state slots rather than a single string so each cell can be
  // targeted individually for focus management and paste distribution.
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const [resentMsg, setResentMsg] = useState('')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const code = digits.join('')

  function handleChange(i: number, val: string) {
    const cleaned = val.replace(/\D/g, '')
    if (!cleaned) {
      const next = [...digits]; next[i] = ''; setDigits(next); return
    }
    // Spread multi-character input (e.g. autofill from SMS) across subsequent
    // slots rather than discarding the extra characters, then advance focus.
    const next = [...digits]
    for (let j = 0; j < cleaned.length && i + j < 6; j++) next[i + j] = cleaned[j]
    setDigits(next)
    inputRefs.current[Math.min(i + cleaned.length, 5)]?.focus()
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent) {
    // Backspace on an already-empty cell moves focus left; the previous cell's
    // value is then cleared by the next keydown, making deletion feel natural.
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    // Pad to exactly 6 slots so array length is always invariant regardless
    // of paste content length; concat+slice is cheaper than fill+splice.
    const next = pasted.split('').concat(Array(6).fill('')).slice(0, 6)
    setDigits(next)
    inputRefs.current[Math.min(pasted.length, 5)]?.focus()
  }

  async function handleResend() {
    setResending(true); setResentMsg(''); setError('')
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to resend.') }
      else { setResentMsg('New code sent. Check your email (or Docker logs).'); setDigits(['', '', '', '', '', '']); inputRefs.current[0]?.focus() }
    } catch { setError('An unexpected error occurred.') }
    finally { setResending(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.length < 6) { setError('Enter all 6 digits.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, code }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Verification failed.'); return }
      router.push('/')
    } catch {
      setError('An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-7 w-7 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to <strong className="text-foreground">{email}</strong>.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Expires in 10 minutes. Check your spam folder if needed.</p>
        <p className="mt-1 text-xs text-yellow-400">No SMTP configured? Check Docker logs for the code.</p>
      </div>

      <div className="flex justify-center gap-2" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input key={i} ref={el => { inputRefs.current[i] = el }}
            type="text" inputMode="numeric" maxLength={6}
            value={d}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            className="h-14 w-11 rounded-xl border-2 border-border bg-background text-center text-xl font-bold focus:border-primary focus:outline-none transition-colors" />
        ))}
      </div>

      {error && (
        <div className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400 text-center">{error}</div>
      )}
      {resentMsg && (
        <div className="rounded-lg bg-green-400/10 px-3 py-2 text-sm text-green-400 text-center">{resentMsg}</div>
      )}

      <button type="submit" disabled={code.length < 6 || loading}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {loading ? 'Verifying…' : 'Verify Email & Create Account'}
      </button>

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back
        </button>
        <button type="button" onClick={() => void handleResend()} disabled={resending}
          className="text-primary hover:underline disabled:opacity-50 transition-colors">
          {resending ? 'Sending…' : "Didn't get it? Resend"}
        </button>
      </div>
    </form>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function RegisterForm() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [pendingId, setPendingId] = useState('')
  const [email, setEmail] = useState('')
  const [verificationRequired, setVerificationRequired] = useState<boolean | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/register-config')
      const d = await res.json() as { emailVerificationRequired: boolean }
      setVerificationRequired(d.emailVerificationRequired)
    } catch {
      setVerificationRequired(true) // safe default if fetch fails
    }
  }, [])

  useEffect(() => { void fetchConfig() }, [fetchConfig])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Create Account</h1>
          {verificationRequired && (
            <div className="mt-3 flex items-center justify-center gap-2">
              {[1, 2].map(n => (
                <div key={n} className={`h-2 w-2 rounded-full transition-colors ${n === step ? 'bg-primary' : n < step ? 'bg-primary/50' : 'bg-muted'}`} />
              ))}
              <span className="ml-1 text-xs text-muted-foreground">Step {step} of 2</span>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
          {step === 1
            ? <StepOne
                onNext={(id, em) => { setPendingId(id); setEmail(em); setStep(2) }}
                onDone={() => router.push('/')}
                verificationRequired={verificationRequired}
              />
            : <StepTwo pendingId={pendingId} email={email} onBack={() => setStep(1)} />
          }
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="text-primary hover:underline font-medium">Sign in</a>
        </p>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>
}
