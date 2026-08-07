/**
 * Admin blocklist management (decision gate-chain, feature 1).
 *
 *   GET    — list blocklisted releases (info_hash, title, reason, blocked_at)
 *   POST   — block a release  body: { infoHash, title?, reason? }
 *   DELETE — unblock a release body: { infoHash }
 *
 * A blocklisted info_hash is hard-gated out of every auto-grab (the metadata reaper adds dead
 * stuck torrents here automatically; admins can add/remove manually). All mutations are
 * requireAdmin + verifyOrigin (S2).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getBlocklist, addToBlocklist, removeFromBlocklist } from '@/lib/automation/gates'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json({ blocklist: getBlocklist() })
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  let body: { infoHash?: unknown; title?: unknown; reason?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const infoHash = typeof body.infoHash === 'string' ? body.infoHash.trim() : ''
  if (!infoHash) return NextResponse.json({ error: 'infoHash required' }, { status: 400 })

  const title = typeof body.title === 'string' ? body.title : null
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'blocked by admin'
  addToBlocklist(infoHash, title, reason)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  let body: { infoHash?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const infoHash = typeof body.infoHash === 'string' ? body.infoHash.trim() : ''
  if (!infoHash) return NextResponse.json({ error: 'infoHash required' }, { status: 400 })

  const removed = removeFromBlocklist(infoHash)
  return NextResponse.json({ ok: true, removed })
}
