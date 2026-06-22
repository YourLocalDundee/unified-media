import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import { searchSubtitles } from '@/lib/subtitle/opensubtitles'

export const dynamic = 'force-dynamic'

// Candidate shape sent to the player. Trimmed from the OpenSubtitles response so
// the browser never sees uploader internals it can't use.
export interface SubtitleCandidate {
  fileId: number
  language: string
  release: string
  fileName: string
  hi: boolean
  fromTrusted: boolean
  downloadCount: number
  format: string
  uploader: string
}

// On-demand OpenSubtitles search for the item currently open in the player.
// The IMDB id is resolved server-side from the media id so it never has to travel
// to (or be trusted from) the browser. Any authenticated viewer can search —
// search does not consume the OpenSubtitles daily *download* quota; only the grab
// route does.
export async function GET(req: NextRequest) {
  await requireAuth()

  const mediaId = req.nextUrl.searchParams.get('mediaId')
  const language = (req.nextUrl.searchParams.get('language') || 'en').trim()
  const hi = req.nextUrl.searchParams.get('hi') === '1'

  if (!mediaId) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 })
  }

  if (!process.env.OPENSUBTITLES_API_KEY) {
    return NextResponse.json(
      { error: 'Subtitle search is not configured (OPENSUBTITLES_API_KEY unset).' },
      { status: 503 }
    )
  }

  const item = getItemById(mediaId)
  if (!item) {
    return NextResponse.json({ error: 'Media item not found' }, { status: 404 })
  }

  // OpenSubtitles wants the numeric IMDB id without the "tt" prefix.
  const imdb_id = item.imdb_id ? item.imdb_id.replace(/^tt/i, '') : undefined
  const type = item.type === 'episode' ? 'episode' : 'movie'

  const results = await searchSubtitles({
    imdb_id,
    // Fall back to a title query when the item has no IMDB id mapped yet.
    query: imdb_id ? undefined : item.title,
    languages: language,
    type,
    hearing_impaired: hi ? 'only' : 'include',
  })

  const candidates: SubtitleCandidate[] = results
    .map((sub) => {
      const file = sub.attributes.files[0]
      if (!file) return null
      const attrs = sub.attributes
      return {
        fileId: file.file_id,
        language: attrs.language,
        release: attrs.release || file.file_name || 'Unknown release',
        fileName: file.file_name || '',
        hi: !!attrs.hearing_impaired,
        fromTrusted: !!attrs.from_trusted,
        downloadCount: attrs.download_count ?? 0,
        format: attrs.format ?? 'srt',
        uploader: attrs.uploader?.name ?? '',
      }
    })
    .filter((c): c is SubtitleCandidate => c !== null)

  return NextResponse.json({ candidates, hasImdb: !!imdb_id })
}
