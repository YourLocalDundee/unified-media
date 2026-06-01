import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import { getDb } from '@/lib/db/index'
import { readFile } from 'fs/promises'

export const dynamic = 'force-dynamic'

interface SubtitleWant {
  subtitle_path: string | null
  language: string
  status: string
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; streamIndex: string }> }
) {
  await requireAuth()
  const { id, streamIndex } = await params

  const item = getItemById(id)
  if (!item?.file_path) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Look up downloaded subtitle files for this media item
  const db = getDb()
  const subtitles = db
    .prepare(
      `SELECT subtitle_path, language, status FROM subtitle_wants
       WHERE media_path = ? AND status = 'downloaded' AND subtitle_path IS NOT NULL
       ORDER BY language`
    )
    .all(item.file_path) as SubtitleWant[]

  const idx = parseInt(streamIndex, 10)
  const subtitle = subtitles[idx]
  if (!subtitle?.subtitle_path) {
    return new NextResponse('Subtitle not found', { status: 404 })
  }

  try {
    const content = await readFile(subtitle.subtitle_path, 'utf-8')
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
