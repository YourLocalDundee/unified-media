'use client'

/**
 * StartPartyButton — creates a watch party for the current item and hands the
 * resulting partyId/joinCode/hostUserId back to the player via onStarted. Surfaces
 * the join code/link inline after creation.
 */

import { useState } from 'react'
import { Users, Loader2 } from 'lucide-react'
import { createParty } from '@/lib/party/client'

interface Props {
  itemId: string
  selfUserId: string
  onStarted: (info: { partyId: string; joinCode: string; hostUserId: string; joinUrl: string }) => void
  className?: string
}

export function StartPartyButton({ itemId, selfUserId, onStarted, className }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await createParty(itemId)
      // The creator is the host.
      onStarted({
        partyId: res.partyId,
        joinCode: res.joinCode,
        hostUserId: selfUserId,
        joinUrl: res.joinUrl,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start party')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={start}
        disabled={loading}
        className={
          className ??
          'flex items-center gap-1.5 rounded-md bg-zinc-800/80 px-3 py-1.5 text-sm text-white transition-colors hover:bg-zinc-700 disabled:opacity-60'
        }
        aria-label="Start watch party"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
        Watch party
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
