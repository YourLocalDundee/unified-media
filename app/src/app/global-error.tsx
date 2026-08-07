// Global error boundary (A16/A17-1). The ONLY boundary that can catch a throw in
// the root layout or its Providers — error.tsx cannot, because it renders inside
// the layout. It must supply its own <html>/<body> since it replaces the root
// layout entirely. Client component per the App Router contract. Intentionally
// self-contained (inline styles + theme-token classes) so it renders even if app
// CSS/providers failed to load.
'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error boundary caught:', error)
  }, [error])

  return (
    <html lang="en" className="dark" data-theme="dark">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'hsl(222 47% 11%)',
          color: 'hsl(213 31% 91%)',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{ maxWidth: '28rem', padding: '1.5rem', textAlign: 'center' }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'hsl(215 20% 55%)', margin: '0 0 1.25rem' }}>
            The application hit an unexpected error. Reloading usually fixes it.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: 'hsl(215 20% 45%)', margin: '0 0 1.25rem' }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              borderRadius: '0.5rem',
              border: 'none',
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              backgroundColor: 'hsl(217 91% 60%)',
              color: 'hsl(222 47% 11%)',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
