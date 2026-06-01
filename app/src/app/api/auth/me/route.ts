import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ userId: session.userId, username: session.username, role: session.role })
}
