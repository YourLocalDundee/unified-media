import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { scanLibrary } from '@/lib/subtitle/scanner'

export const dynamic = 'force-dynamic'

export async function POST() {
  await requireAdmin()
  try {
    const result = await scanLibrary()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
