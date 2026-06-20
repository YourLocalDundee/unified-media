// GET + PUT /api/admin/settings
// Thin proxy to the settings lib which reads/writes the app_settings SQLite table.
// All values are stored and returned as strings; callers cast to their expected type.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getSettings, setSetting } from '@/lib/settings/index'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json(getSettings())
}

export async function PUT(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  let body: Record<string, string>
  try { body = await req.json() as Record<string, string> }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard
  // Only persist entries where both key and value are strings — silently drops
  // anything malformed rather than erroring, to be tolerant of future field additions.
  for (const [key, value] of Object.entries(body)) {
    if (typeof key === 'string' && typeof value === 'string') {
      setSetting(key, value)
    }
  }
  return NextResponse.json(getSettings())
}
