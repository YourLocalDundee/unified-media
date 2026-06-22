import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { readFile } from 'fs/promises'
import { srtToVtt, isAlreadyVtt } from '@/lib/subtitle/vtt'

export const dynamic = 'force-dynamic'

interface WantRow {
  subtitle_path: string | null
  status: string
}

// Serve a downloaded subtitle by its subtitle_wants primary key, as WebVTT.
//
// The sibling /api/media/subtitles/{id}/{index} route keys by *positional* index
// into the ordered downloaded query for a media item. That position shifts when a
// new subtitle is added, which is fine at page-load (the player rebuilds the list)
// but unsafe for a track injected live mid-playback. Keying by the immutable row id
// gives the on-demand grab path a stable URL that never points at the wrong file.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wantId: string }> }
) {
  await requireAuth()
  const { wantId } = await params
  const id = parseInt(wantId, 10)
  if (isNaN(id)) {
    return new NextResponse('Invalid subtitle id', { status: 400 })
  }

  const row = getDb()
    .prepare(
      `SELECT subtitle_path, status FROM subtitle_wants
       WHERE id = ? AND status = 'downloaded' AND subtitle_path IS NOT NULL`
    )
    .get(id) as WantRow | undefined

  if (!row?.subtitle_path) {
    return new NextResponse('Subtitle not found', { status: 404 })
  }

  try {
    const raw = await readFile(row.subtitle_path, 'utf-8')
    const content = isAlreadyVtt(raw) ? raw : srtToVtt(raw)
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new NextResponse('Subtitle file not found on disk', { status: 404 })
  }
}
