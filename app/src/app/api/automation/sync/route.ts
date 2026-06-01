import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { checkAvailability } from '@/lib/automation/availability'

export const dynamic = 'force-dynamic'

export async function POST() {
  await requireAdmin()
  try {
    const updated = await checkAvailability()
    return NextResponse.json({ updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
