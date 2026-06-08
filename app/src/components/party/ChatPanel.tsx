'use client'

/**
 * ChatPanel — the party chat. Renders the message list (server-stamped sender
 * name + relative time), auto-scrolls to newest, distinguishes the local user's
 * messages, and sends on Enter. Independent of playback — typing never touches
 * the video. The chat_backlog the joiner receives is already in chatMessages.
 */

import { useEffect, useRef, useState } from 'react'
import { Send, ArrowDown } from 'lucide-react'
import type { ChatMessageDTO } from '@/lib/party/types'

// Don't yank a user who scrolled up; only auto-scroll when already near the bottom.
const NEAR_BOTTOM_THRESHOLD_PX = 60

interface Props {
  messages: ChatMessageDTO[]
  selfUserId: string
  onSend: (text: string) => void
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return new Date(ts).toLocaleDateString()
}

export function ChatPanel({ messages, selfUserId, onSend }: Props) {
  const [text, setText] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Only follow new messages if the user is already at/near the bottom.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX)
  }

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    // Defensive cap mirroring the input maxLength; the server is the real gate.
    onSend(trimmed.slice(0, 500))
    setText('')
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col border-t border-zinc-800">
      <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-zinc-500">Chat</p>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2"
      >
        {messages.length === 0 && (
          <p className="text-[11px] text-zinc-600">No messages yet. Say hi.</p>
        )}
        {messages.map((m) => {
          const mine = m.from.userId === selfUserId
          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[11px] font-medium ${mine ? 'text-sky-300' : 'text-zinc-300'}`}>
                  {mine ? 'You' : m.from.displayName}
                </span>
                <span className="text-[10px] text-zinc-600">{relativeTime(m.ts)}</span>
              </div>
              <div
                className={`max-w-[85%] rounded-lg px-2 py-1 text-sm ${
                  mine ? 'bg-sky-900/60 text-sky-50' : 'bg-zinc-800 text-zinc-100'
                }`}
              >
                {m.text}
              </div>
            </div>
          )
        })}
      </div>
      {!atBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom()
            setAtBottom(true)
          }}
          className="absolute bottom-14 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-sky-700 px-2.5 py-1 text-[11px] text-white shadow-lg transition-colors hover:bg-sky-600"
        >
          <ArrowDown className="h-3 w-3" />
          Latest
        </button>
      )}
      <div className="flex items-center gap-1.5 border-t border-zinc-800 p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Message…"
          maxLength={500}
          className="min-w-0 flex-1 rounded-md bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-sky-600"
        />
        <button
          type="button"
          onClick={submit}
          className="rounded-md bg-sky-700 p-1.5 text-white transition-colors hover:bg-sky-600"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
