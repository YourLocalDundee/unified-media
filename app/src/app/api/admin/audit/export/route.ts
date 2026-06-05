// GET /api/admin/audit/export
// Returns the full audit_log as a CSV file. Optional ?from= and ?to= query params
// accept ISO date strings (e.g. 2025-01-01) and filter by created_at range.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

// Escape a CSV field: wrap in quotes and double any internal quotes.
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

interface AuditRow {
  id: number
  event_type: string
  user_id: number | null
  username: string | null
  ip_address: string | null
  details: string | null
  created_at: number
}

export async function GET(req: NextRequest) {
  await requireAdmin()

  const { searchParams } = req.nextUrl
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const db = getDb()

  let rows: AuditRow[]

  if (fromParam || toParam) {
    // Convert ISO date strings to Unix ms timestamps for comparison.
    const fromMs = fromParam ? new Date(fromParam).getTime() : 0
    const toMs = toParam ? new Date(toParam + 'T23:59:59.999Z').getTime() : Number.MAX_SAFE_INTEGER

    rows = db.prepare(`
      SELECT a.id, a.event_type, a.user_id, u.username, a.ip_address, a.details, a.created_at
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= ? AND a.created_at <= ?
      ORDER BY a.created_at ASC
    `).all(fromMs, toMs) as AuditRow[]
  } else {
    rows = db.prepare(`
      SELECT a.id, a.event_type, a.user_id, u.username, a.ip_address, a.details, a.created_at
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at ASC
    `).all() as AuditRow[]
  }

  const header = ['id', 'event_type', 'user_id', 'username', 'ip', 'details', 'created_at'].join(',')

  const csvRows = rows.map(row => [
    csvField(row.id),
    csvField(row.event_type),
    csvField(row.user_id),
    csvField(row.username),
    csvField(row.ip_address),
    csvField(row.details),
    csvField(row.created_at ? new Date(row.created_at).toISOString() : null),
  ].join(','))

  const csv = [header, ...csvRows].join('\n')

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="audit-log.csv"',
    },
  })
}
