import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit } from '@/lib/rate-limit'
import { getItemById } from '@/lib/media-server/library'
import { upsertSubtitleWant, updateSubtitleStatus } from '@/lib/subtitle/monitor'
import { getDownloadLink } from '@/lib/subtitle/opensubtitles'
import fs from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

interface GrabBody {
  mediaId?: string
  fileId?: number
  language?: string
  hi?: boolean
  forced?: boolean
}

// Write the downloaded subtitle next to the media file, mirroring the auto-download
// path (writeSrtFile in downloader.ts). The filename carries the language plus HI /
// forced markers so distinct variants of the same language don't clobber each other
// on disk. The exact written path is stored in subtitle_wants.subtitle_path, so the
// serving routes resolve whatever was written regardless of naming.
async function writeVariantSrt(
  mediaPath: string,
  language: string,
  content: string,
  opts: { hi: boolean; forced: boolean }
): Promise<string | null> {
  // Reject obvious non-SRT content (A15-M4): valid SRT files begin with a numeric counter line.
  const trimmed = content.trimStart()
  if (!trimmed || !/^\d/.test(trimmed)) {
    console.error('[subtitle] Grabbed content does not look like an SRT file — discarding')
    return null
  }

  const ext = path.extname(mediaPath)
  const base = mediaPath.slice(0, mediaPath.length - ext.length)
  const suffix = `${language}${opts.hi ? '.hi' : ''}${opts.forced ? '.forced' : ''}`
  const outPath = `${base}.${suffix}.srt`
  const tmpPath = `${outPath}.${process.pid}.tmp`
  try {
    // Atomic write: temp file then rename so a crash mid-write can't corrupt an
    // existing subtitle file.
    await fs.writeFile(tmpPath, content, 'utf-8')
    await fs.rename(tmpPath, outPath)
    return outPath
  } catch (err) {
    console.error('[subtitle] Failed to write grabbed srt file:', err)
    return null
  }
}

// On-demand grab: download a specific OpenSubtitles file the viewer picked and
// persist it like an auto-downloaded subtitle. Returns the stable subtitle_wants id
// so the player can inject a <track> at /api/media/subtitles/want/{wantId}.
export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // CSRF
  }
  const session = await requireAuth()

  // The OpenSubtitles daily download quota is shared across all users (plan-dependent:
  // 5/day free, 1000/day on the VIP plan). This per-user cap is an abuse guard, not the
  // quota itself — 20 grabs per hour per user. The real quota is surfaced to the UI via
  // `remaining` on each grab.
  const limit = checkRateLimit(`subtitle-grab:${session.userId}`, 20, 60 * 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many subtitle downloads — try again later.' },
      { status: 429 }
    )
  }

  if (!process.env.OPENSUBTITLES_API_KEY) {
    return NextResponse.json(
      { error: 'Subtitle download is not configured (OPENSUBTITLES_API_KEY unset).' },
      { status: 503 }
    )
  }
  if (!process.env.SUBTITLE_MEDIA_ROOT) {
    return NextResponse.json(
      { error: 'Subtitle disk writes are not enabled (SUBTITLE_MEDIA_ROOT unset).' },
      { status: 503 }
    )
  }

  let body: GrabBody
  try {
    body = (await req.json()) as GrabBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const mediaId = body.mediaId
  const fileId = body.fileId
  const language = (body.language || '').trim()
  const hi = !!body.hi
  const forced = !!body.forced

  if (!mediaId || typeof fileId !== 'number' || !Number.isFinite(fileId) || !language) {
    return NextResponse.json({ error: 'mediaId, fileId, and language are required' }, { status: 400 })
  }

  const item = getItemById(mediaId)
  if (!item?.file_path) {
    return NextResponse.json({ error: 'Media item not found' }, { status: 404 })
  }

  // Persist (or reuse) the want row so the grab survives a reload and shows on the
  // admin subtitle page alongside auto-downloads.
  const want = upsertSubtitleWant({
    jellyfin_item_id: item.id,
    jellyfin_item_type: item.type === 'movie' ? 'Movie' : 'Episode',
    title: item.title,
    imdb_id: item.imdb_id ? item.imdb_id.replace(/^tt/i, '') : undefined,
    media_path: item.file_path,
    language,
    forced: forced ? 1 : 0,
    hi: hi ? 1 : 0,
  })

  // Resolve the download link and pull the file.
  let link: string
  let remaining = -1
  try {
    const dl = await getDownloadLink(fileId)
    if (!dl?.link) {
      await updateSubtitleStatus(want.id, 'failed')
      return NextResponse.json({ error: 'OpenSubtitles returned no download link.' }, { status: 502 })
    }
    link = dl.link
    remaining = dl.remaining
  } catch (err) {
    await updateSubtitleStatus(want.id, 'failed')
    const msg = String(err)
    // 406 from OpenSubtitles means the daily download quota is exhausted.
    const quota = /406/.test(msg)
    return NextResponse.json(
      { error: quota ? 'OpenSubtitles daily download limit reached.' : 'Failed to get download link.' },
      { status: quota ? 429 : 502 }
    )
  }

  let content: string
  try {
    const res = await fetch(link)
    if (!res.ok) {
      await updateSubtitleStatus(want.id, 'failed')
      return NextResponse.json({ error: `Download failed (HTTP ${res.status}).` }, { status: 502 })
    }
    content = await res.text()
  } catch {
    await updateSubtitleStatus(want.id, 'failed')
    return NextResponse.json({ error: 'Failed to download subtitle file.' }, { status: 502 })
  }

  const outPath = await writeVariantSrt(item.file_path, language, content, { hi, forced })
  if (!outPath) {
    await updateSubtitleStatus(want.id, 'failed')
    return NextResponse.json({ error: 'Downloaded file was not a valid subtitle.' }, { status: 422 })
  }

  await updateSubtitleStatus(want.id, 'downloaded', {
    subtitle_file_id: fileId,
    subtitle_path: outPath,
  })

  const langLabel = language.toUpperCase()
  const tags = [forced ? 'Forced' : null, hi ? 'HI' : null].filter(Boolean).join(', ')
  const label = tags ? `${langLabel} (${tags})` : langLabel

  return NextResponse.json({
    wantId: want.id,
    label,
    language,
    forced,
    remaining,
  })
}
