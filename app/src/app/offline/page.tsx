// Offline fallback shell. Served by public/sw.js when a navigation fetch fails
// while truly offline (see the networkFirstNavigation() strategy there).
//
// This page is precached at service-worker install time and is the ONLY page
// this app ever caches, because it renders no user/session data — every other
// route is auth-gated and must never be served from Cache Storage. Also
// listed as a public path in src/proxy.ts so the precache fetch never bounces
// through the login redirect.
import Link from 'next/link'

export const metadata = {
  title: 'Offline — Unified Media',
}

export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-4">
        <p className="text-5xl font-bold text-muted-foreground">Offline</p>
        <h1 className="text-2xl font-bold text-foreground">No connection</h1>
        <p className="text-sm text-muted-foreground">
          Unified Media needs a connection to load your library, requests, and downloads.
          Reconnect and try again.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-block rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          >
            Try again
          </Link>
        </div>
      </div>
    </div>
  )
}
