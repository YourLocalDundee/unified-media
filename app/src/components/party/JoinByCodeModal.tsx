'use client'

/**
 * JoinByCodeModal — manual code entry. Calls joinParty({joinCode}) and hands the
 * resolved party back to the caller (which activates the sync hook).
 */

import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { joinParty } from '@/lib/party/client'

interface Props {
  onJoined: (info: { partyId: string; mediaId: string; joinCode: string }) => void
  onClose: () => void
}

export function JoinByCodeModal({ onJoined, onClose }: Props) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Close on Escape regardless of focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (loading) return
    const trimmed = code.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await joinParty({ joinCode: trimmed })
      onJoined(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join party')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Join a watch party</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) submit()
          }}
          placeholder="Enter join code"
          autoFocus
          className="w-full rounded-md bg-zinc-800 px-3 py-2 font-mono tracking-widest text-white placeholder-zinc-500 outline-none focus:ring-1 focus:ring-sky-600"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={loading || !code.trim()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Join
        </button>
      </div>
    </div>
  )
}
