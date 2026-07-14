import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getDb } from '@/lib/db/index'
import { setSeriesNumberingMode } from '@/lib/subtitle/numbering'

export const dynamic = 'force-dynamic'

interface Body {
  mode?: 'season' | 'absolute' | null
}

// Manual override for the subtitle-search numbering scheme picked for a series (see
// numbering.ts). `mode: null` clears back to auto-detect on the next episode search.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  const { id } = await params

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (body.mode !== 'season' && body.mode !== 'absolute' && body.mode !== null) {
    return NextResponse.json({ error: "mode must be 'season', 'absolute', or null" }, { status: 400 })
  }

  const db = getDb()
  const series = db.prepare("SELECT id FROM media_items WHERE id = ? AND type = 'series'").get(id)
  if (!series) {
    return NextResponse.json({ error: 'Series not found' }, { status: 404 })
  }

  setSeriesNumberingMode(id, body.mode)
  return NextResponse.json({ id, mode: body.mode })
}
