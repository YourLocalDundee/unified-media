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

  const cleaned = cleanName(name)
  if (!cleaned) {
    return NextResponse.json(null)
  }

  const db = getDb()
  const row = db.prepare(
    `SELECT id, title, type, year FROM media_items WHERE LOWER(title) LIKE LOWER(?) LIMIT 1`
  ).get(`%${cleaned}%`) as { id: string; title: string; type: string; year: number | null } | undefined

  if (!row) {
    return NextResponse.json(null)
  }

  return NextResponse.json({ id: row.id, title: row.title })
}
