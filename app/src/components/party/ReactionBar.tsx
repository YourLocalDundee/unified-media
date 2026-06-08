'use client'

/**
 * ReactionBar — the eight fixed v1 emoji reactions as a row of buttons. Each
 * fires sendReaction; the server fans it back as a reaction broadcast which the
 * overlay renders.
 */

import { ALLOWED_REACTIONS } from '@/lib/party/constants'

interface Props {
  onReact: (emoji: string) => void
}

export function ReactionBar({ onReact }: Props) {
  return (
    <div className="flex items-center gap-0.5">
      {ALLOWED_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          className="rounded p-1 text-lg leading-none transition-transform hover:scale-125 hover:bg-white/10 active:scale-95"
          aria-label={`React ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
