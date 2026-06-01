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
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  const hasSession = request.cookies.has('unified-session')

  const isPublic = PUBLIC_PATHS.some(
    p => pathname === p || pathname.startsWith(p + '/')
  )

  // Redirect logged-in users away from auth pages
  if (hasSession && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // UX redirect to login if no session cookie
  // (Real security is in requireAuth() in each Server Component)
  if (!isPublic && !hasSession) {
    const loginUrl = new URL('/login', request.url)
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
