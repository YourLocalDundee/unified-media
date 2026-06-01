import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import bcrypt from 'bcryptjs'

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function genTempPw(): string {
  const array = new Uint8Array(12)
  crypto.getRandomValues(array)
  let pw = ''
  for (const b of array) pw += UPPER[b % UPPER.length]
  // Ensure it meets policy: add lowercase + special
  return pw.slice(0, 8) + 'x!' + pw.slice(8, 10) + pw.slice(10)
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params
  const tempPassword = genTempPw()
  const hash = bcrypt.hashSync(tempPassword, 12)
  getDb().prepare('UPDATE users SET password_hash = ?, force_pw_change = 1, updated_at = ? WHERE id = ?')
    .run(hash, Date.now(), id)
  await logEvent('password_changed', { byAdmin: true, targetId: id }, { userId: session.userId, username: session.username })
  return NextResponse.json({ tempPassword })
}
