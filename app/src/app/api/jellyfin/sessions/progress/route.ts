import { NextRequest, NextResponse } from 'next/server'
import { jellyfinFetch } from '@/lib/jellyfin/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  await jellyfinFetch('/Sessions/Playing/Progress', { method: 'POST', body: JSON.stringify(body) })
  return NextResponse.json({ ok: true })
}
