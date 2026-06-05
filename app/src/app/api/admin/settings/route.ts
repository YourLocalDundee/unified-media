// GET + PUT /api/admin/settings
// Thin proxy to the settings lib which reads/writes the app_settings SQLite table.
// All values are stored and returned as strings; callers cast to their expected type.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getSettings, setSetting } from '@/lib/settings/index'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json(getSettings())
}

export async function PUT(req: NextRequest) {
  await requireAdmin()
  const body = await req.json() as Record<string, string>
  // Only persist entries where both key and value are strings — silently drops
  // anything malformed rather than erroring, to be tolerant of future field additions.
  for (const [key, value] of Object.entries(body)) {
    if (typeof key === 'string' && typeof value === 'string') {
      setSetting(key, value)
    }
  }
  return NextResponse.json(getSettings())
}
