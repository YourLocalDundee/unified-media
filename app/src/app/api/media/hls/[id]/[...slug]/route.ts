/**
 * GET /api/media/hls/[id]/master.m3u8   — HLS manifest
 * GET /api/media/hls/[id]/seg00001.ts   — HLS segment
 *
 * Dispatches to the transcode layer in lib/media-server/transcode.ts.
 * Codec-tier decision is made there; this route is responsible only for
 * auth, item lookup, probe, and serving files from the transcode cache.
 *
 * Seek behaviour: segment requests poll for 10 s. A 503 means the segment
 * is ahead of the current linear transcode position — seek backwards to
 * a position that has already been transcoded and retry. See transcode.ts
 * for the full v1 seek behaviour documentation.
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import { probeFile } from '@/lib/media-server/probe'
import { ensureHls, getSegmentPath, waitForSegment } from '@/lib/media-server/transcode'

export const dynamic = 'force-dynamic'

async function serveFile(
  filePath: string,
  contentType: string,
): Promise<NextResponse> {
  const data = await fs.readFile(filePath)
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type':  contentType,
      'Cache-Control': 'no-cache, no-store',
    },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string[] }> },
) {
  await requireAuth()

  const { id, slug } = await params
  const resource = slug.join('/')   // 'master.m3u8' | 'seg00001.ts' | …

  const item = getItemById(id)
  if (!item?.file_path) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // -------------------------------------------------------------------------
  // Manifest request — probe the file, kick off or reuse the transcode
  // -------------------------------------------------------------------------

  if (resource === 'master.m3u8') {
    let videoCodec: string | null = null
    let audioCodec: string | null = null
    try {
      const probe = await probeFile(item.file_path)
      videoCodec = probe.videoCodec
      audioCodec = probe.audioCodec
    } catch (err) {
      console.error(`[hls] probe failed for ${id}:`, err)
      // Proceed with null codecs — chooseTier will default to full_vaapi
    }

    let manifestPath: string
    try {
      manifestPath = await ensureHls(id, item.file_path, videoCodec, audioCodec)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[hls] ensureHls failed for ${id}:`, msg)
      return NextResponse.json(
        { error: 'Transcode failed', detail: msg },
        { status: 503 },
      )
    }

    return serveFile(manifestPath, 'application/x-mpegURL')
  }

  // -------------------------------------------------------------------------
  // Segment request — serve from cache, polling if the transcode is in progress
  // -------------------------------------------------------------------------

  const segPath = getSegmentPath(id, resource)
  const found   = await waitForSegment(segPath)

  if (!found) {
    // Segment has not been generated within the poll window. Most likely cause:
    // the player seeked past the current transcode position. Seek backwards and
    // retry. hls.js will surface a player error after its retry limit is reached.
    return new NextResponse(null, {
      status: 503,
      headers: {
        'X-Transcode-Status': 'segment-not-ready',
        'Retry-After':        '5',
      },
    })
  }

  return serveFile(segPath, 'video/mp2t')
}
