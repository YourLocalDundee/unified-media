import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/dal'
import { getAllRequests, getRequestCounts } from '@/lib/requests/monitor'
import AdminRequestsClient from './AdminRequestsClient'

export const metadata: Metadata = {
  title: 'Requests — Admin',
}

export default async function AdminRequestsPage() {
  await requireAdmin()

  const [requests, counts] = await Promise.all([
    Promise.resolve(getAllRequests()),
    Promise.resolve(getRequestCounts()),
  ])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">Review and action media requests.</p>
      </div>

      <div className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1 rounded-lg bg-zinc-900 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pending</p>
          <p className="text-3xl font-bold text-yellow-400">{counts.pending}</p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-zinc-900 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Approved</p>
          <p className="text-3xl font-bold text-blue-400">{counts.approved}</p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-zinc-900 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Declined</p>
          <p className="text-3xl font-bold text-red-400">{counts.declined}</p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-zinc-900 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Available</p>
          <p className="text-3xl font-bold text-green-400">{counts.available}</p>
        </div>
      </div>

      <AdminRequestsClient initialRequests={requests} />
    </div>
  )
}
