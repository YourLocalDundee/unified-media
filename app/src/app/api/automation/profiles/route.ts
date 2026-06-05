/**
 * GET /api/automation/profiles
 *
 * Returns all quality profiles from the quality_profiles table.
 * Used by the admin automation page to populate the quality profile dropdown when
 * adding a new monitored item. Profiles include the conditions JSON string as-is;
 * the UI doesn't need to parse it — it only displays the profile name.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getAllProfiles } from '@/lib/automation/monitor'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const profiles = getAllProfiles()
  return NextResponse.json(profiles)
}
