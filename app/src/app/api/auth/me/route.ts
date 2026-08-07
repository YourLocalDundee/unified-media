/**
 * GET /api/auth/me — returns the current session identity for client-side
 * use by AuthContext. Called on every app mount with cache: 'no-store' to
 * ensure stale identity is never served after logout or a role change.
 *
 * force-dynamic prevents Next.js from caching this route at the edge or in
 * the full-route cache — it must always hit the DB to validate the session.
 * Returns only the fields needed by the client (userId, username, displayName, role);
 * the full session object (IP, UA, expiry) stays server-side only.
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
  })
}
