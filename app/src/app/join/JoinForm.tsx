'use client'

// Invite card shown on /join to unauthenticated visitors.
//
// Key variables:
//   joinCode    — 6-char party code passed from the server component; sent to the API
//   mediaId     — media_items.id of the item being watched; used for the /play redirect
//   name        — controlled input: the nickname the guest wants to use (default "Guest")
//   loading     — true while the POST to /api/party/guest-session is in flight
//   error       — non-empty string when the API returns an error; shown below the input

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  joinCode: string
  mediaId: string
}

export function JoinForm({ joinCode, mediaId }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/party/guest-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinCode, displayName: name.trim() || 'Guest' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? 'Failed to join. Please try again.')
        return
      }
      router.push(`/play/${mediaId}?party=${joinCode}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-white">You&apos;re invited to a watch party</h1>
        <p className="mt-1 text-sm text-zinc-400">Enter a nickname to join.</p>
        <div className="mt-5 flex flex-col gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !loading) void handleJoin() }}
            placeholder="Guest"
            maxLength={32}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            autoFocus
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="button"
            onClick={() => void handleJoin()}
            disabled={loading}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
          >
            {loading ? 'Joining…' : 'Join party'}
          </button>
        </div>
      </div>
    </div>
  )
}
