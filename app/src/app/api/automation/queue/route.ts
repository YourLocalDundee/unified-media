import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getGrabHistory } from '@/lib/automation/monitor'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const history = getGrabHistory()
  return NextResponse.json(history)
}
