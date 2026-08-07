'use client'

/**
 * JoinPartyButton — manual "join with code" entry point (A5-01). The JoinByCodeModal
 * was fully built but never mounted anywhere, leaving the spec-required manual-code
 * join path dead (only the `?party=` one-tap link worked). This mounts it.
 *
 * On a successful join it navigates to `/play/${mediaId}?party=${joinCode}` rather than
 * activating sync in place (A5-02), so the player always loads the party's actual media
 * — a code for a party watching item B can't sync against item A.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import { JoinByCodeModal } from './JoinByCodeModal'

export function JoinPartyButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
      >
        <Users className="h-4 w-4" />
        Join watch party
      </button>
      {open && (
        <JoinByCodeModal
          onClose={() => setOpen(false)}
          onJoined={({ mediaId, joinCode }) => {
            setOpen(false)
            router.push(`/play/${mediaId}?party=${joinCode}`)
          }}
        />
      )}
    </>
  )
}
