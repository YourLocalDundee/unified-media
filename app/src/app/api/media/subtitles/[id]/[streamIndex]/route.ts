import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import { getDb } from '@/lib/db/index'
import { readFile } from 'fs/promises'
import { srtToVtt, isAlreadyVtt } from '@/lib/subtitle/vtt'

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

  // Look up downloaded subtitle files for this media item (positional index into this result)
  const db = getDb()
  const subtitles = db
    .prepare(
      `SELECT subtitle_path, language, status FROM subtitle_wants
       WHERE media_path = ? AND status = 'downloaded' AND subtitle_path IS NOT NULL
       ORDER BY language, forced, hi`
    )
    .all(item.file_path) as SubtitleWant[]

  const idx = parseInt(streamIndex, 10)
  if (isNaN(idx) || idx < 0 || idx >= subtitles.length) {
    return new NextResponse('Subtitle not found', { status: 404 })
  }
  const subtitle = subtitles[idx]
  if (!subtitle?.subtitle_path) {
    return new NextResponse('Subtitle not found', { status: 404 })
  }

  try {
    const raw = await readFile(subtitle.subtitle_path, 'utf-8')
    // Convert SRT to VTT if the file doesn't already have a WEBVTT header.
    // The downloader saves files as .srt; the <track> element requires WebVTT.
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
