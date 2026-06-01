import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { downloadPendingSubtitles } from '@/lib/subtitle/downloader'

export const dynamic = 'force-dynamic'

export async function POST() {
  await requireAdmin()
  try {
    const result = await downloadPendingSubtitles()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
