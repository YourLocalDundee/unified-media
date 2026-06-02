'use client'

import { useState } from 'react'
import type { NativeRequestWithUser, RequestStatus } from '@/lib/requests/types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RequestsTableProps {
  requests: NativeRequestWithUser[]
  isAdmin: boolean
  currentUserId: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmdbImageUrl(path: string, size = 'w92') {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  available: 'Available',
  expired: 'Expired',
}

const STATUS_COLORS: Record<RequestStatus, string> = {
  pending: 'bg-yellow-600 text-white',
  approved: 'bg-blue-600 text-white',
  declined: 'bg-red-600 text-white',
  available: 'bg-green-600 text-white',
  expired: 'bg-zinc-600 text-zinc-300',
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function parsedSeasons(seasons: string | null): number[] {
  if (!seasons) return []
  try {
    return JSON.parse(seasons) as number[]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

type RowAction = 'approve' | 'decline' | 'delete'

async function callAction(
  id: number,
  action: RowAction
): Promise<Response> {
  if (action === 'delete') {
    return fetch(`/api/requests/${id}`, { method: 'DELETE' })
  }
  return fetch(`/api/requests/${id}/${action}`, { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  request: NativeRequestWithUser
  isAdmin: boolean
  isOwner: boolean
  onUpdate: (id: number, status: RequestStatus) => void
  onDelete: (id: number) => void
}

function RequestRow({ request, isAdmin, isOwner, onUpdate, onDelete }: RowProps) {
  const [busy, setBusy] = useState<RowAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const statusLabel = STATUS_LABELS[request.status]
  const statusColor = STATUS_COLORS[request.status]
  const seasons = parsedSeasons(request.seasons)

  async function handleAction(action: RowAction) {
    setBusy(action)
    setError(null)

    // Optimistic update
    if (action === 'delete') {
      onDelete(request.id)
    } else {
      onUpdate(request.id, action === 'approve' ? 'approved' : 'declined')
    }

    try {
      const res = await callAction(request.id, action)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
    } catch (err) {
      setError(action === 'delete' ? 'Delete failed' : `${action} failed`)
      // Revert optimistic update
      if (action === 'delete') {
        // Can't easily revert a delete since the row is gone; error shown briefly
      } else {
        onUpdate(request.id, request.status)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors">
      {/* Poster */}
      <td className="py-3 pl-4 pr-3 w-14">
        {request.poster_path ? (
          <img
            src={tmdbImageUrl(request.poster_path, 'w92')}
            alt={request.title}
            className="h-16 w-11 rounded object-cover"
          />
        ) : (
          <div className="h-16 w-11 rounded bg-zinc-800 flex items-center justify-center text-zinc-600 text-[10px] text-center px-1">
            No image
          </div>
        )}
      </td>

      {/* Title + seasons */}
      <td className="py-3 px-3">
        <p className="font-medium text-white leading-tight">{request.title}</p>
        {request.year && (
          <p className="text-xs text-zinc-500 mt-0.5">{request.year}</p>
        )}
        {seasons.length > 0 && (
          <p className="text-xs text-zinc-500 mt-0.5">
            {seasons.length} season{seasons.length !== 1 ? 's' : ''}
          </p>
        )}
        {error && (
          <p className="text-xs text-red-400 mt-1">{error}</p>
        )}
      </td>

      {/* Type */}
      <td className="py-3 px-3 hidden sm:table-cell">
        <span className="text-sm text-zinc-400">
          {request.media_type === 'movie' ? 'Movie' : 'TV Show'}
        </span>
      </td>

      {/* Status badge */}
      <td className="py-3 px-3">
        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${statusColor}`}>
          {statusLabel}
        </span>
      </td>

      {/* Requested by (admin only) */}
      {isAdmin && (
        <td className="py-3 px-3 text-sm text-zinc-400 hidden md:table-cell">
          {request.username}
        </td>
      )}

      {/* Date */}
      <td className="py-3 px-3 text-sm text-zinc-500 hidden lg:table-cell whitespace-nowrap">
        {formatDate(request.created_at)}
      </td>

      {/* Actions */}
      <td className="py-3 pl-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-2">
          {isAdmin && request.status === 'pending' && (
            <>
              <button
                onClick={() => handleAction('approve')}
                disabled={busy !== null}
                className="rounded bg-blue-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'approve' ? '…' : 'Approve'}
              </button>
              <button
                onClick={() => handleAction('decline')}
                disabled={busy !== null}
                className="rounded bg-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-600 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'decline' ? '…' : 'Decline'}
              </button>
            </>
          )}
          {(isOwner || isAdmin) && (
            <button
              onClick={() => handleAction('delete')}
              disabled={busy !== null}
              className="rounded bg-red-600/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Delete request"
            >
              {busy === 'delete' ? '…' : 'Delete'}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// RequestsTable
// ---------------------------------------------------------------------------

export default function RequestsTable({ requests: initialRequests, isAdmin, currentUserId }: RequestsTableProps) {
  const [rows, setRows] = useState<NativeRequestWithUser[]>(initialRequests)

  function handleUpdate(id: number, status: RequestStatus) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status } : r))
    )
  }

  function handleDelete(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500">
        No requests found.
      </div>
    )
  }

  return (
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
            <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Status
            </th>
            {isAdmin && (
              <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden md:table-cell">
                Requested By
              </th>
            )}
            <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden lg:table-cell">
              Date
            </th>
            <th className="py-3 pl-3 pr-4 text-xs font-medium uppercase tracking-wide text-zinc-500 text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              isAdmin={isAdmin}
              isOwner={request.user_id === currentUserId}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
