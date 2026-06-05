/**
 * Next.js proxy — UX-layer redirect guard only.
 *
 * This is NOT a security boundary. Its sole job is to bounce
 * unauthenticated visitors to /login so they see a prompt instead of a
 * broken page. Real auth enforcement happens in requireAuth() / requireAdmin()
 * inside each Server Component and Route Handler (see src/lib/dal.ts).
 *
 * Why the split? The proxy runs in the Edge Runtime and cannot access
 * Node.js APIs (no SQLite, no crypto module beyond Web Crypto), so session
 * validation against the DB must happen server-side at the component level.
 *
 * CVE-2025-29927: rely on cookie presence here, validate token in the DAL.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Paths that are always public (no auth required)
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot',
  '/reset-password',
  '/change-password',
  '/invite',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/register',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/me',
  '/api/auth/check-username',
  '/api/auth/change-password',
  '/api/health',
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow Next.js internals and static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    // Any path with a dot is treated as a static asset (e.g. .png, .js)
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Cookie presence is a cheap heuristic — the token is validated in getSession()
  const hasSession = request.cookies.has('unified-session')

  const isPublic = PUBLIC_PATHS.some(
    // startsWith(p + '/') handles sub-paths like /reset-password/confirm
    p => pathname === p || pathname.startsWith(p + '/')
  )

  // UX redirect to login if no session cookie
  // (Real security is in requireAuth() in each Server Component)
  if (!isPublic && !hasSession) {
    const loginUrl = new URL('/login', request.url)
    // Preserve intended destination so login can redirect back after success
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
