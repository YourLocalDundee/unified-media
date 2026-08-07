// GET /api/admin/server-status
// Aggregates health data from three sources: the local SQLite DB, the Node.js process
// itself, and the qBittorrent service. Each check fails gracefully — a timeout or
// unreachable service returns {ok: false} rather than a 500.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { statSync } from 'fs'
import { access, constants } from 'fs/promises'

export const dynamic = 'force-dynamic'

interface StatRow { c: number }

async function checkService(url: string): Promise<{ ok: boolean; version: string | null }> {
  try {
    // 3s timeout prevents the response from hanging if a service is unreachable.
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { ok: false, version: null }
    const text = await res.text()
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      // Try common version field names across different services (qBittorrent uses plain string).
      const version = (json.Version ?? json.version ?? json.data ?? null) as string | null
      return { ok: true, version: typeof version === 'string' ? version : null }
    } catch {
      // Response was not JSON — treat the raw text as the version string.
      return { ok: true, version: text.trim().slice(0, 20) }
    }
  } catch {
    return { ok: false, version: null }
  }
}

export async function GET() {
  await requireAdmin()
  const db = getDb()
  let dbSize = 0
  // statSync is safe here because DB_PATH is a local file; falls back to 0 if unset.
  if (process.env.DB_PATH) {
    try { dbSize = statSync(process.env.DB_PATH).size } catch { /* ignore */ }
  }

  let mediaOk = false
  // MEDIA_ROOTS is colon-separated; only check the first path for the status page.
  const mediaRoot = (process.env.MEDIA_ROOTS ?? '').split(':').filter(Boolean)[0] ?? null
  if (mediaRoot) {
    try { await access(mediaRoot, constants.R_OK); mediaOk = true } catch { /* ignore */ }
  }

  const qbit = await checkService(`${process.env.QBT_URL ?? 'http://qbittorrent:8080'}/api/v2/app/version`)

  return NextResponse.json({
    db: {
      size: dbSize,
      ok: true,
      users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as StatRow).c,
      sessions: (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as StatRow).c,
      watches: (db.prepare('SELECT COUNT(*) as c FROM watch_events').get() as StatRow).c,
      auditEntries: (db.prepare('SELECT COUNT(*) as c FROM audit_log').get() as StatRow).c,
    },
    media: { ok: mediaOk, root: mediaRoot ?? null },
    qbit,
    app: {
      nodeVersion: process.version,
      // process.uptime() returns seconds as a float; convert to ms for consistency.
      uptimeMs: Math.floor(process.uptime() * 1000),
      // RSS (resident set size) is the most meaningful single memory figure for Docker resource limits.
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  })
}
