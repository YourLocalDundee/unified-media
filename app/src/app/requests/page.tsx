import type { Metadata } from 'next'
import { requireAuth } from '@/lib/dal'
import { getAllRequests, getUserRequests, getRequestCounts } from '@/lib/requests/monitor'
import type { RequestStatus } from '@/lib/requests/types'
import RequestsTable from './RequestsTable'

export const metadata: Metadata = {
  title: 'Requests — unified-frontend',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterValue = 'all' | 'pending' | 'approved' | 'declined' | 'available' | 'expired'

const FILTER_TABS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'available', label: 'Available' },
  { value: 'expired', label: 'Expired' },
]

// ---------------------------------------------------------------------------
// Stats card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-zinc-900 px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{count}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

function FilterTabs({ active }: { active: FilterValue }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {FILTER_TABS.map((tab) => (
        <a
          key={tab.value}
          href={`/requests?filter=${tab.value}`}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.value
              ? 'bg-white text-black'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {tab.label}
        </a>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page — server component
// ---------------------------------------------------------------------------

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const session = await requireAuth()
  const { filter } = await searchParams

  const filterValue = (
    ['all', 'pending', 'approved', 'declined', 'available', 'expired'].includes(filter ?? '')
      ? filter
      : 'all'
  ) as FilterValue

  const statusOpt = filterValue === 'all' ? undefined : (filterValue as RequestStatus)

  const isAdmin = session.role === 'admin'

  // Always fetch the full unfiltered list so slot counts are accurate regardless of the active filter.
  const [allRequests, counts] = await Promise.all([
    isAdmin
      ? Promise.resolve(getAllRequests())
      : Promise.resolve(getUserRequests(session.userId)),
    Promise.resolve(getRequestCounts()),
  ])

  // Filter in-memory for display — avoids a second DB round-trip.
  const requests = statusOpt ? allRequests.filter((r) => r.status === statusOpt) : allRequests

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Requests</h1>
        </div>

        {/* Stats row */}
        <div className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Pending" count={counts.pending} color="text-yellow-400" />
          <StatCard label="Approved" count={counts.approved} color="text-blue-400" />
          <StatCard label="Declined" count={counts.declined} color="text-red-400" />
          <StatCard label="Available" count={counts.available} color="text-green-400" />
        </div>

        {/* Filter tabs */}
        <div className="mb-6">
          <FilterTabs active={filterValue} />
        </div>

        {/* Table — always rendered so the slot meter shows even when filtered list is empty */}
        <RequestsTable
          requests={requests}
          allRequests={allRequests}
          isAdmin={isAdmin}
          currentUserId={session.userId}
        />
      </div>
    </div>
  )
}
