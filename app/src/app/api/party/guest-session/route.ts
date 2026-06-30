// POST /api/party/guest-session — create a throwaway guest account + 8h session for party join.
//
// Public endpoint (no requireAuth). Called from /join when a visitor without an account
// wants to join a watch party via an invite link.
//
// Key variables:
//   joinCode       — the 6-char party code from the invite link (e.g. "AB12CD")
//   displayName    — nickname the guest typed on the invite page (max 32 chars, default "Guest")
//   userId         — makeId(32) UUID for the new throwaway user row
//   username       — "guest_<makeId(12)>" — unique, opaque, never shown
//   sessionId      — makeId(32) session token stored in the unified-session cookie
//   GUEST_SESSION_TTL_MS — 8 hours; shorter than the normal 30-day TTL so stale guests
//                   don't persist long. The session row expires naturally; no cleanup job needed.
//   is_guest = 1   — flag on the users row so admin tooling can identify / filter guests

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db/index'
import { makeId } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { getActivePartyByCode, upsertMember } from '@/lib/party/db'

export const dynamic = 'force-dynamic'

const GUEST_SESSION_TTL_MS = 8 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ip = getClientIp(req)
  const rl = checkRateLimit(`guest-join:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { joinCode?: string; displayName?: string } | null
  if (!body?.joinCode) {
    return NextResponse.json({ error: 'joinCode is required' }, { status: 400 })
  }

  const party = getActivePartyByCode(body.joinCode.toUpperCase())
  if (!party) {
    return NextResponse.json({ error: 'Party not found or already ended' }, { status: 404 })
  }

  const displayName = (body.displayName ?? '').trim().slice(0, 32) || 'Guest'

  const db = getDb()
  const now = Date.now()
  const userId = makeId(32)
  const username = `guest_${makeId(12)}`

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at, updated_at, is_active, display_name, is_guest)
     VALUES (?, ?, '', 'user', ?, ?, 1, ?, 1)`
  ).run(userId, username, now, now, displayName)

  const sessionId = makeId(32)
  db.prepare(
    `INSERT INTO sessions (id, user_id, ip_address, created_at, expires_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, userId, ip, now, now + GUEST_SESSION_TTL_MS, now)

  upsertMember(party.id, userId)

  const cookieStore = await cookies()
  try {
    cookieStore.set('unified-session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_SESSION_TTL_MS / 1000,
    })
  } catch { /* should not throw in route handler context */ }

  return NextResponse.json({ mediaId: party.media_id, partyId: party.id, joinCode: party.join_code })
}
