// GET  /api/admin/users — paginated user list.
// POST /api/admin/users — create an account.
//
// Public sign-up is closed (POST /api/auth/register returns 403), so this is the only way an
// account comes into existence apart from the first-run admin seed. Unlike the register route
// this deliberately does NOT create a session or touch cookies — the admin stays signed in as
// themselves, and the new user signs in on their own.
// Server-paginated user list with optional search, role, and status filters.
// Builds the WHERE clause dynamically to keep params as bound values (not interpolated)
// and avoid SQLi while still supporting the full filter matrix.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { verifyOrigin } from '@/lib/csrf'
import { getClientIp } from '@/lib/client-ip'
import { hashPassword, validatePassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAdmin()
  const db = getDb()
  const { searchParams } = req.nextUrl
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const search = searchParams.get('search') ?? ''
  const role = searchParams.get('role') ?? 'all'
  const status = searchParams.get('status') ?? 'all'
  const limit = 25

  // Start with a tautology so every clause can be appended as AND without special-casing the first.
  let where = 'WHERE 1=1'
  const params: (string | number)[] = []

  if (search) {
    // LOWER() on both sides for case-insensitive match without a collation change.
    where += ' AND (LOWER(username) LIKE ? OR LOWER(COALESCE(email,\'\')) LIKE ?)'
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`)
  }
  if (role !== 'all') { where += ' AND role = ?'; params.push(role) }
  if (status === 'active') { where += ' AND is_active = 1' }
  if (status === 'suspended') { where += ' AND is_active = 0' }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM users ${where}`).get(...params) as { c: number }).c
  const users = db.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM watch_events WHERE user_id = u.id) as watch_count
     FROM users u ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit)

  return NextResponse.json({ users, total, page, pages: Math.ceil(total / limit) })
}

// 8-byte base62, same alphabet as the register route's makeUserId.
function makeUserId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAdmin()
  const ip = getClientIp(req)

  let body: { username?: string; email?: string; password?: string; role?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const username = body.username?.trim()
  const email = body.email?.trim().toLowerCase()
  const password = body.password
  const role = body.role === 'admin' ? 'admin' : 'user'

  if (!username || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json({ error: 'Username must be 3-20 characters (letters, numbers, underscores).' }, { status: 400 })
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  if (!password) {
    return NextResponse.json({ error: 'A password is required.' }, { status: 400 })
  }
  const pw = validatePassword(password, username)
  if (!pw.valid) return NextResponse.json({ errors: pw.errors }, { status: 400 })

  const db = getDb()
  if (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)) {
    return NextResponse.json({ error: 'That username is taken.' }, { status: 409 })
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return NextResponse.json({ error: 'That email is already registered.' }, { status: 409 })
  }

  const now = Date.now()
  const userId = makeUserId()
  const hash = await hashPassword(password)

  // force_pw_change so the password the admin typed is a handover credential, not the user's
  // permanent one — requireAuth() sends them to /change-password until they set their own.
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at, is_active, force_pw_change)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`
  ).run(userId, username, email, hash, role, now, now)

  await logEvent('user_created', { username, email, role, createdBy: session.username },
    { userId, username, ip })

  return NextResponse.json({ id: userId, username, email, role }, { status: 201 })
}
