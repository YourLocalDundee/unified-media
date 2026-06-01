'use client'

import { useState } from 'react'
import type { NativeRequestWithUser, RequestStatus } from '@/lib/requests/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'pending' | 'approved' | 'declined' | 'available'

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'available', label: 'Available' },
]

const STATUS_BADGE: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-600/30 text-yellow-300' },
  approved: { label: 'Approved', className: 'bg-blue-600/30 text-blue-300' },
  declined: { label: 'Declined', className: 'bg-red-600/30 text-red-300' },
  available: { label: 'Available', className: 'bg-green-600/30 text-green-300' },
}

function tmdbImageUrl(path: string, size = 'w92') {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

function formatTimestamp(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface RowProps {
  req: NativeRequestWithUser
  localStatus: RequestStatus | null
  onApprove: (id: number) => void
  onDecline: (id: number) => void
  onDelete: (id: number) => void
  busy: boolean
}

function RequestRow({ req, localStatus, onApprove, onDecline, onDelete, busy }: RowProps) {
  const effectiveStatus: RequestStatus = localStatus ?? req.status
  const badge = STATUS_BADGE[effectiveStatus]

  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors">
      {/* Poster */}
      <td className="py-3 pl-4 pr-3 w-14">
        {req.poster_path ? (
          <img
            src={tmdbImageUrl(req.poster_path, 'w92')}
            alt={req.title}
            className="h-16 w-11 rounded object-cover"
          />
        ) : (
          <div className="h-16 w-11 rounded bg-zinc-800 flex items-center justify-center text-zinc-600 text-[10px] text-center px-1">
            No image
          </div>
        )}
      </td>

      {/* Title + Year */}
      <td className="py-3 px-3">
        <p className="font-medium text-white leading-tight">{req.title}</p>
        {req.year && <p className="text-xs text-zinc-500 mt-0.5">{req.year}</p>}
      </td>

      {/* Type */}
      <td className="py-3 px-3 text-sm text-zinc-400 hidden sm:table-cell">
        {req.media_type === 'movie' ? 'Movie' : 'TV Show'}
      </td>

      {/* Requester */}
      <td className="py-3 px-3 text-sm text-zinc-400 hidden md:table-cell">
        {req.username}
      </td>

      {/* Date */}
      <td className="py-3 px-3 text-sm text-zinc-500 hidden lg:table-cell whitespace-nowrap">
        {formatTimestamp(req.created_at)}
      </td>

      {/* Status badge */}
      <td className="py-3 px-3">
        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
          {badge.label}
        </span>
      </td>

      {/* Actions */}
      <td className="py-3 pl-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {effectiveStatus === 'pending' && (
            <>
              <button
                onClick={() => onApprove(req.id)}
                disabled={busy}
                className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => onDecline(req.id)}
                disabled={busy}
                className="bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                Decline
              </button>
            </>
          )}
          <button
            onClick={() => onDelete(req.id)}
            disabled={busy}
            className="bg-red-900/40 hover:bg-red-900/70 text-red-400 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

interface AdminRequestsClientProps {
  initialRequests: NativeRequestWithUser[]
}

export default function AdminRequestsClient({ initialRequests }: AdminRequestsClientProps) {
  const [requests, setRequests] = useState<NativeRequestWithUser[]>(initialRequests)
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  // Per-row optimistic status overrides
  const [localStatuses, setLocalStatuses] = useState<Record<number, RequestStatus>>({})
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())

  function setBusy(id: number, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  function setLocalStatus(id: number, status: RequestStatus) {
    setLocalStatuses((prev) => ({ ...prev, [id]: status }))
  }

  async function handleApprove(id: number) {
    setBusy(id, true)
    try {
      const res = await fetch(`/api/requests/${id}/approve`, { method: 'POST' })
      if (res.ok) {
        setLocalStatus(id, 'approved')
      }
    } finally {
      setBusy(id, false)
    }
  }

  async function handleDecline(id: number) {
    if (!confirm('Decline this request?')) return
    setBusy(id, true)
    try {
      const res = await fetch(`/api/requests/${id}/decline`, { method: 'POST' })
      if (res.ok) {
        setLocalStatus(id, 'declined')
      }
    } finally {
      setBusy(id, false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this request? This cannot be undone.')) return
    setBusy(id, true)
    try {
      const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        setRequests((prev) => prev.filter((r) => r.id !== id))
        setLocalStatuses((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    } finally {
      setBusy(id, false)
    }
  }

  const visibleRequests = requests.filter((req) => {
    if (activeFilter === 'all') return true
    const effectiveStatus = localStatuses[req.id] ?? req.status
    return effectiveStatus === activeFilter
  })

  return (
    <>
      {/* Filter tabs */}
      <div className="mb-6 flex gap-1 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveFilter(tab.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeFilter === tab.value
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visibleRequests.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500">
          No requests found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="py-3 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-zinc-500 w-14">
                  Poster
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Title
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden sm:table-cell">
                  Type
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden md:table-cell">
                  Requested By
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden lg:table-cell">
                  Date
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Status
                </th>
                <th className="py-3 pl-3 pr-4 text-xs font-medium uppercase tracking-wide text-zinc-500 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((req) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  localStatus={localStatuses[req.id] ?? null}
                  onApprove={handleApprove}
                  onDecline={handleDecline}
                  onDelete={handleDelete}
                  busy={busyIds.has(req.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
