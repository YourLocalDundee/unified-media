import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getRequestById, updateRequestStatus } from '@/lib/requests/monitor'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAdmin()

  // Keyed by the acting admin, not their IP — see the note in api/admin/users/[id]/route.ts.
  const rl = checkRateLimit(`admin-decline:${session.userId}`, 60, 5 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl)

  const { id: idStr } = await params

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const request = getRequestById(id)
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  updateRequestStatus(id, 'declined')

  const updated = getRequestById(id)
  return NextResponse.json(updated)
}
