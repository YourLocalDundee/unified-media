/**
 * Upgrade-until-cutoff admin API (mining Tier-2 #5).
 *
 *   GET  — list recent/in-flight upgrades (pending | completed | failed)
 *   POST — manually trigger an upgrade scan now (body: { itemId? } to scan a single item)
 *
 * Scans normally run on a 6-hour cron; this lets an admin force one. requireAdmin (+ verifyOrigin on POST).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { scanForUpgrades, listUpgrades } from '@/lib/automation/upgrade'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json({ upgrades: listUpgrades() })
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  let body: { itemId?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    // empty/invalid body is fine — defaults to a full scan
  }
  const itemId = typeof body.itemId === 'number' ? body.itemId : undefined

  const result = await scanForUpgrades({ itemId })
  return NextResponse.json({ ok: true, ...result })
}
