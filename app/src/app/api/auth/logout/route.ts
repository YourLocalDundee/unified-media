import { NextResponse } from 'next/server'
import { getSession, deleteSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'

export async function POST() {
  const session = await getSession()
  if (session) {
    await deleteSession(session.sessionId)
    await logEvent('logout', {}, { userId: session.userId, username: session.username })
  }
  const cookieStore = await cookies()
  cookieStore.delete('unified-session')
  return NextResponse.json({ ok: true })
}
