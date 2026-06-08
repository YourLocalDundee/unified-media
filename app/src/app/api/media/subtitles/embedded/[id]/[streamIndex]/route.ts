/**
 * GET /api/media/subtitles/embedded/[id]/[streamIndex]
 *
 * Extracts a single *embedded* subtitle stream from the media file (by absolute ffprobe
 * stream index) and returns it as WebVTT for attachment as a <track>. A plain <video>
 * element does not render embedded MKV subtitle streams on Direct Play, so the player
 * points each embedded subtitle track at this endpoint instead.
 *
 * Text-based codecs (ass, subrip/srt, mov_text, webvtt) convert cleanly. Image-based
 * codecs (PGS/VOBSUB/DVB) cannot become WebVTT — they would need burn-in — and are
 * rejected with 415. This route is distinct from /api/media/subtitles/[id]/[streamIndex],
 * which serves downloaded *external* subtitle files.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import { probeFile } from '@/lib/media-server/probe'
import { isImageSubtitleCodec } from '@/lib/media-server/codecs'
import { extractSubtitleToVtt } from '@/lib/media-server/transcode'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; streamIndex: string }> },
) {
  await requireAuth()
  const { id, streamIndex } = await params

  const item = getItemById(id)
  if (!item?.file_path) {
    return new NextResponse('Not found', { status: 404 })
  }

  const absoluteIndex = parseInt(streamIndex, 10)
  if (!Number.isInteger(absoluteIndex) || absoluteIndex < 0) {
    return new NextResponse('Invalid stream index', { status: 400 })
  }

  // Confirm the requested stream exists and is a text subtitle before extracting.
  try {
    const probe = await probeFile(item.file_path)
    const sub = probe.subtitleStreams.find(s => s.index === absoluteIndex)
    if (!sub) {
      return new NextResponse('Subtitle stream not found', { status: 404 })
    }
    if (isImageSubtitleCodec(sub.codec)) {
      return new NextResponse(
        `Image-based subtitle (${sub.codec}) cannot be converted to WebVTT; burn-in required.`,
        { status: 415 },
      )
    }
  } catch {
    // Probe failure is non-fatal — fall through and let extraction surface the real error.
  }

  try {
    const vttPath = await extractSubtitleToVtt(id, item.file_path, absoluteIndex)
    const content = await readFile(vttPath, 'utf-8')
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    console.error(`[subtitles] extraction failed for ${id} stream ${absoluteIndex}:`, err)
    return new NextResponse('Subtitle extraction failed', { status: 500 })
  }
}
