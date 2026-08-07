import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getAllSubtitles } from '@/lib/subtitle/monitor'
import type { SubtitleStatus } from '@/lib/subtitle/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAdmin()
  const filter = req.nextUrl.searchParams.get('filter')
  const valid: SubtitleStatus[] = ['wanted', 'downloaded', 'skipped', 'failed']
  const status = valid.includes(filter as SubtitleStatus) ? (filter as SubtitleStatus) : undefined
  return NextResponse.json(getAllSubtitles(status))
}
