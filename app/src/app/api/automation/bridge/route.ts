/**
 * GET /api/automation/bridge
 *
 * Returns all monitored items that have a tmdb_id — i.e. items that arrived via
 * the request approval bridge rather than being added manually.
 *
 * Used exclusively by the admin bridge page (/admin/automation/bridge) to show the
 * end-to-end status of request → grab → import for request-driven content.
 *
 * The response shape is a projected subset of MonitoredItem — root_path and monitored
 * are omitted since they're irrelevant to the bridge view.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { findAllBridgedItems } from '@/lib/automation/bridge'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const raw = findAllBridgedItems()
  // Project to a clean DTO — root_path and monitored (0/1) are internal and not needed by UI
  const items = raw.map(({ item }) => ({
    id: item.id,
    tmdb_id: item.tmdb_id,
    tvdb_id: item.tvdb_id,
    type: item.type,
    title: item.title,
    year: item.year,
    status: item.status,
    quality_profile_id: item.quality_profile_id,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }))
  return NextResponse.json(items)
}
