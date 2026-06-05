// POST /api/admin/users/[id]/reset-password
// Generates a cryptographically random temporary password, hashes it, and flags
// the account for a forced password change on next login. The plaintext temp password
// is returned once and never stored — the admin must copy it immediately.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import bcrypt from 'bcryptjs'

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function genTempPw(): string {
  const array = new Uint8Array(12)
  // crypto.getRandomValues provides cryptographically secure randomness (not Math.random).
  crypto.getRandomValues(array)
  let pw = ''
  for (const b of array) pw += UPPER[b % UPPER.length]
  // Splice in 'x!' to guarantee the password passes the lowercase + special char policy.
  return pw.slice(0, 8) + 'x!' + pw.slice(8, 10) + pw.slice(10)
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params
  const tempPassword = genTempPw()
  // bcrypt cost factor 12 matches the app-wide password policy in lib/password.ts.
  const hash = bcrypt.hashSync(tempPassword, 12)
  // force_pw_change = 1 forces the user to set a new password before they can use the app.
  getDb().prepare('UPDATE users SET password_hash = ?, force_pw_change = 1, updated_at = ? WHERE id = ?')
    .run(hash, Date.now(), id)
  await logEvent('password_changed', { byAdmin: true, targetId: id }, { userId: session.userId, username: session.username })
  return NextResponse.json({ tempPassword })
}
