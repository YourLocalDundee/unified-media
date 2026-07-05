import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { setDisplayModeOverride, type DisplayMode } from '@/lib/media-server/display-prefs'

export const dynamic = 'force-dynamic'

// Admin-only per-show override of the discover-page Arcs/Seasons display. Only meaningful for
// shows that actually have TMDB arc-grouping data — a show with no arcs already shows plain
// seasons, so there's nothing to override there.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tmdbId: string }> },
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  const { tmdbId: tmdbIdStr } = await params
  const tmdbId = parseInt(tmdbIdStr, 10)
  if (isNaN(tmdbId)) return NextResponse.json({ error: 'Invalid tmdbId' }, { status: 400 })

  const body = await req.json().catch(() => null) as { mode?: string } | null
  if (body?.mode !== 'arcs' && body?.mode !== 'seasons') {
    return NextResponse.json({ error: "mode must be 'arcs' or 'seasons'" }, { status: 400 })
  }

  setDisplayModeOverride(tmdbId, body.mode as DisplayMode)
  return NextResponse.json({ tmdbId, mode: body.mode })
}
