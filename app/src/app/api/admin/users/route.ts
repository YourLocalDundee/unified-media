import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

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

  let where = 'WHERE 1=1'
  const params: (string | number)[] = []

  if (search) {
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
