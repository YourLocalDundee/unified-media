/**
 * GET /api/media/hls/[id]/a[N]/master.m3u8   — HLS manifest for audio track N
 * GET /api/media/hls/[id]/a[N]/seg00001.ts   — HLS segment for audio track N
 *
 * The `aN` segment is the audio-relative index (`-map 0:a:N`). It lets the player
 * switch audio track by requesting a different `aN` URL; each track gets its own
 * transcode + cache. A missing `aN` segment defaults to audio track 0 for
 * backwards compatibility. Segments in the manifest are relative, so they resolve
 * under the same `aN/` path automatically.
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
import { selectAudioTrack } from '@/lib/media-server/codecs'
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

  // Optional leading `aN` segment selects the audio-relative track; default 0.
  let audioRel = 0
  let parts = slug
  if (slug.length > 1 && /^a\d+$/.test(slug[0])) {
    audioRel = parseInt(slug[0].slice(1), 10)
    parts = slug.slice(1)
  }
  const resource = parts.join('/')   // 'master.m3u8' | 'seg00001.ts' | …

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
    let audioIndex = audioRel
    try {
      const probe = await probeFile(item.file_path)
      videoCodec = probe.videoCodec
      // The requested audio track drives both the tier choice and the `-map 0:a:N` target.
      // If the requested index is out of range, fall back to the intended (default-or-first)
      // track so a stale/garbage URL still produces a usable stream.
      if (audioRel >= 0 && audioRel < probe.audioStreams.length) {
        audioCodec = probe.audioStreams[audioRel].codec
      } else {
        const { stream: intendedAudio, relativeIndex } = selectAudioTrack(probe.audioStreams)
        audioCodec = intendedAudio?.codec ?? null
        audioIndex = relativeIndex
      }
    } catch (err) {
      console.error(`[hls] probe failed for ${id}:`, err)
      // Proceed with null codecs — chooseTier will default to full_vaapi
    }

    let manifestPath: string
    try {
      manifestPath = await ensureHls(id, item.file_path, videoCodec, audioCodec, audioIndex)
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

  const segPath = getSegmentPath(id, audioRel, resource)
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
