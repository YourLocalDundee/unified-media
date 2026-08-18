import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getJob } from '@/lib/jobs/queue'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth()
  const { id } = await params
  const job = getJob(id)
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Owner-or-admin. Job ids are unguessable, but a job carries scan/download results, so the
  // id alone is not the gate. 404 rather than 403 to avoid confirming the id exists.
  if (session.role !== 'admin' && job.userId !== session.userId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  return NextResponse.json(job)
}
