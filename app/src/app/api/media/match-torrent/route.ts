import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

function cleanName(name: string): string {
  return name
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|bluray|web-dl|webrip|hdtv|dvdrip|bdrip|hevc|h265|h264|x265|x264|aac|dts|ac3|atmos|hdr|sdr|remux)\b.*/gi, '')
    .replace(/[._\-\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET(req: NextRequest) {
  await requireAuth()

  const name = req.nextUrl.searchParams.get('name')
  if (!name) {
    return NextResponse.json(null)
  }

  // A7-07: cap the input length before any processing. A release name is at most a few
  // hundred chars; a longer value is junk and only makes the LIKE scan more expensive.
  if (name.length > 300) {
    return NextResponse.json(null)
  }

  const cleaned = cleanName(name)
  if (!cleaned) {
    return NextResponse.json(null)
  }

  // A7-07: escape LIKE wildcards so a title containing % or _ can't widen the match to
  // the whole table (`%` matches everything). The ESCAPE clause makes \ the escape char.
  const likePattern = `%${cleaned.replace(/[\\%_]/g, '\\$&')}%`

  const db = getDb()
  const row = db.prepare(
    `SELECT id, title, type, year FROM media_items WHERE LOWER(title) LIKE LOWER(?) ESCAPE '\\' LIMIT 1`
  ).get(likePattern) as { id: string; title: string; type: string; year: number | null } | undefined

  if (!row) {
    return NextResponse.json(null)
  }

  return NextResponse.json({ id: row.id, title: row.title })
}
