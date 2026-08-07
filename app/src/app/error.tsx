// Root route-segment error boundary (A16/A17-1). Catches an uncaught throw from
// any page/layout/lib call below the root and renders an app-styled recovery UI
// with a `reset()` retry. Must be a client component per the App Router contract.
'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log so the failure is at least visible in the browser console / monitoring.
    console.error('Route error boundary caught:', error)
  }, [error])

  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred while loading this page. You can try again,
          or head back home.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70">
            Reference: <code className="font-mono">{error.digest}</code>
          </p>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border bg-card px-5 py-2 text-sm font-medium text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
