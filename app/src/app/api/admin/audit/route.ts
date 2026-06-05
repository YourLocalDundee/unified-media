// GET /api/admin/audit
// Returns a paginated slice of the audit_log table, newest first.
// Page size is 50 — large enough to scan quickly, small enough to keep response times snappy.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAdmin()
  const { searchParams } = req.nextUrl
  // Math.max(1, ...) clamps negative or zero page values that would produce negative OFFSET.
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = 50
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as { c: number }).c
  const entries = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, (page - 1) * limit)
  return NextResponse.json({ entries, total, page, pages: Math.ceil(total / limit) })
}
