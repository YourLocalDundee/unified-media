'use client'

/**
 * ReactionOverlay — renders incoming party reactions as small, semi-transparent
 * emoji that float up and fade out over ~1.6s in the corner of the video. Each
 * removes itself after its animation via expireReaction; multiple cascade.
 */

import { useEffect, useRef } from 'react'
import type { PartyReaction } from '@/hooks/usePartySync'

const ANIM_MS = 1600

interface Props {
  reactions: PartyReaction[]
  onExpire: (id: string) => void
}

export function ReactionOverlay({ reactions, onExpire }: Props) {
  // Track which ids already have an expiry timer so re-renders don't double-arm.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const present = new Set(reactions.map((r) => r.id))

    // Reconcile: clear and drop timers for ids that have left the array so the
    // Map doesn't grow unbounded and stray timers can't fire for gone ids.
    for (const [id, t] of timers.current) {
      if (!present.has(id)) {
        clearTimeout(t)
        timers.current.delete(id)
      }
    }

    // Arm timers only for newly-present ids.
    for (const r of reactions) {
      if (!timers.current.has(r.id)) {
        const t = setTimeout(() => {
          timers.current.delete(r.id)
          onExpire(r.id)
        }, ANIM_MS)
        timers.current.set(r.id, t)
      }
    }
  }, [reactions, onExpire])

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  return (
    <div className="pointer-events-none absolute bottom-24 right-6 z-30 flex flex-col-reverse items-center gap-1">
      <style>{`
        @keyframes party-react-float {
          0%   { opacity: 0; transform: translateY(8px) scale(0.7); }
          15%  { opacity: 0.85; transform: translateY(0) scale(1); }
          70%  { opacity: 0.7; transform: translateY(-32px) scale(1); }
          100% { opacity: 0; transform: translateY(-56px) scale(0.9); }
        }
      `}</style>
      {reactions.map((r) => (
        <div
          key={r.id}
          title={r.from.displayName}
          className="select-none text-3xl drop-shadow-lg"
          style={{ animation: `party-react-float ${ANIM_MS}ms ease-out forwards` }}
        >
          {r.emoji}
        </div>
      ))}
    </div>
  )
}
