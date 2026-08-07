// GET + PUT /api/admin/settings
// Thin proxy to the settings lib which reads/writes the app_settings SQLite table.
// All values are stored and returned as strings; callers cast to their expected type.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getSettings, setSetting, KNOWN_SETTING_KEYS } from '@/lib/settings/index'
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
  // Reject unknown keys (C-3): only allowlisted settings may be persisted, so a typo'd key surfaces
  // as a 400 instead of silently bloating app_settings. Values must be strings (storage is text).
  const entries = Object.entries(body)
  const unknown = entries.filter(([key]) => !KNOWN_SETTING_KEYS.has(key)).map(([key]) => key)
  if (unknown.length > 0) {
    return NextResponse.json({ error: `Unknown setting key(s): ${unknown.join(', ')}` }, { status: 400 })
  }
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      setSetting(key, value)
    }
  }
  return NextResponse.json(getSettings())
}
