// GET + POST /api/admin/invites
// GET returns all invite codes (used and active).
// POST generates a new cryptographically random invite code and stores it.
// Registration no longer requires an invite (v0.5.3+), but these codes still work
// for the /invite/[code] route which skips email verification.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { verifyOrigin } from '@/lib/csrf'

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function generateCode(): string {
  const array = new Uint8Array(12)
  // Uniform distribution over the 36-char alphabet via modulo; bias is negligible at this entropy level.
  crypto.getRandomValues(array)
  let code = ''
  for (const b of array) code += UPPER[b % UPPER.length]
  return code
}

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const invites = getDb().prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all()
  return NextResponse.json(invites)
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  const session = await requireAdmin()
  let body: { label?: string; maxUses?: number; expiresAt?: number | null }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard
  const code = generateCode()
  const now = Date.now()
  getDb().prepare(
    'INSERT INTO invite_codes (code, created_by, label, max_uses, use_count, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(code, session.userId, body.label ?? null, body.maxUses ?? 1, body.expiresAt ?? null, now)
  await logEvent('invite_created', { code, label: body.label }, { userId: session.userId, username: session.username })
  return NextResponse.json({ code })
}
