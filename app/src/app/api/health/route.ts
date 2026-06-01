import { access, constants } from 'fs/promises'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function GET() {
  let db = false
  let media = false

  try {
    getDb().prepare('SELECT 1').get()
    db = true
  } catch { /* db unreachable */ }

  const mediaRoot = (process.env.MEDIA_ROOTS ?? '').split(':').filter(Boolean)[0]
  if (mediaRoot) {
    try {
      await access(mediaRoot, constants.R_OK)
      media = true
    } catch { /* media dir unreachable */ }
  }

  const status = db && media ? 'ok' : 'degraded'
  return Response.json(
    { status, db, media, timestamp: new Date().toISOString() },
    { status: status === 'ok' ? 200 : 503 }
  )
}
