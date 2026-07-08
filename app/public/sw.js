// =============================================================================
// Service worker — Unified Media PWA shell.
//
// SECURITY BOUNDARY (read this before touching the fetch handler below):
// This app has no external auth gateway in front of it — sessions are its own
// SQLite-backed cookies, validated server-side per request (see CLAUDE.md
// "Auth strategy"). Cache Storage is NOT scoped per-user. If this worker ever
// cached an authenticated API response or a page that embeds user/session
// data, a stale copy could leak across accounts on a shared device, survive
// logout, or serve stale permissions. So the boundary is absolute:
//
//   CACHE (cache-first, versioned):
//     - /_next/static/*        build assets, content-hashed by Next — immutable
//     - the manifest + icons   static, non-personalized
//     - /offline               the fallback shell — contains no user data
//
//   NEVER CACHE (network-only, no read or write):
//     - /api/*                 every API route, always
//     - every other HTML document — home/library/browse/downloads/etc. all
//       render user-specific data server-side; a cached copy could show one
//       user another user's session UI
//
// Everything not explicitly allowlisted below falls through to a plain
// network fetch with no cache interaction at all — the safety net for the
// "never cache user data" rule.
// =============================================================================

const SW_VERSION = 'v1'
const SHELL_CACHE = `unified-shell-${SW_VERSION}`

// Precached at install time. Keep this list to genuinely static, non-personalized
// assets only — do not add pages that render per-user data.
const PRECACHE_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith('unified-shell-') && key !== SHELL_CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

function isStaticBuildAsset(url) {
  return url.pathname.startsWith('/_next/static/')
}

function isNeverCache(url) {
  // API routes carry session-scoped data (or mutate state) — never touch cache for these.
  return url.pathname.startsWith('/api/')
}

function isPrecachedAsset(url) {
  return PRECACHE_URLS.includes(url.pathname)
}

self.addEventListener('fetch', event => {
  const { request } = event

  // Never intercept mutating requests — cache-first/GET-only strategies below
  // assume idempotent reads.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never proxy cross-origin requests (TMDB images, etc.) through this worker.
  if (url.origin !== self.location.origin) return

  // Hard boundary: API routes are always network-only, no cache read or write.
  if (isNeverCache(url)) return

  if (isStaticBuildAsset(url) || isPrecachedAsset(url)) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  // Default: plain network fetch, no cache interaction. This is what keeps
  // every other HTML document and any unlisted asset out of Cache Storage.
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) {
    const cache = await caches.open(SHELL_CACHE)
    cache.put(request, response.clone())
  }
  return response
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request)
  } catch {
    // Offline: fall back to the cached offline shell. This is intentionally
    // the only offline experience — we do not attempt to serve library/browse
    // data offline, since that data is auth-gated and must never be cached.
    const offline = await caches.match('/offline')
    if (offline) return offline
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

// -----------------------------------------------------------------------------
// Push notifications — stub for a future feature (Web Push). Intentionally a
// no-op today; a later feature extends this section rather than replacing
// this worker, so keep push/notificationclick handling isolated here.
// -----------------------------------------------------------------------------
self.addEventListener('push', () => {})
self.addEventListener('notificationclick', () => {})
