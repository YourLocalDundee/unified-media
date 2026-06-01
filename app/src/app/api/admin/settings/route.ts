import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getSettings, setSetting } from '@/lib/settings/index'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json(getSettings())
}

export async function PUT(req: NextRequest) {
  await requireAdmin()
  const body = await req.json() as Record<string, string>
  for (const [key, value] of Object.entries(body)) {
    if (typeof key === 'string' && typeof value === 'string') {
      setSetting(key, value)
    }
  }
  return NextResponse.json(getSettings())
}
