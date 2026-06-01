import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getAllProfiles } from '@/lib/automation/monitor'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const profiles = getAllProfiles()
  return NextResponse.json(profiles)
}
