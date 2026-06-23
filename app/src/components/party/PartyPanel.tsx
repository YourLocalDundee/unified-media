'use client'

/**
 * PartyPanel — the party side panel: join code + copy-link, member list with
 * ready/connection indicators and host badge, an attribution line from lastActor,
 * a "waiting to buffer" line, and leave / end controls.
 */

import { useEffect, useRef, useState } from 'react'
import { Copy, Check, LogOut, X, Crown, Loader2, AlertCircle, Trash2, SkipForward, Plus, Search } from 'lucide-react'
import type { MemberSummary, LastActor, QueueItemDTO } from '@/lib/party/types'

interface Props {
  joinCode: string
  joinUrl: string
  mediaId: string
  members: MemberSummary[]
  selfUserId: string
  hostUserId: string | null
  lastActor: LastActor | null
  waitingFor: { userId: string; displayName: string }[]
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'ended'
  onLeave: () => void
  onEnd: () => void
  // --- shared queue (feature 3) ---
  queue: QueueItemDTO[]
  onAddToQueue: (mediaId: string, title?: string) => void
  onRemoveFromQueue: (itemId: string) => void
  onPlayNext: () => void
}

// A playable library item returned by /api/media/items?q= — only non-series rows are queueable.
interface MediaHit {
  id: string
  title: string
  type: string
  year?: number | null
}

/** Search the native library and add a result to the shared queue. */
function QueueAdder({ onAdd }: { onAdd: (mediaId: string, title?: string) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<MediaHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // All setStates run inside the debounce timeout (empty term resolves on a 0ms
  // timer) so none fire synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const term = q.trim()
    if (!term) {
      debounceRef.current = setTimeout(() => {
        setHits([])
        setLoading(false)
      }, 0)
      return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/media/items?q=${encodeURIComponent(term)}&limit=12`)
        const data = (await res.json().catch(() => [])) as MediaHit[]
        // Series containers aren't directly playable — keep movies/episodes only.
        setHits(Array.isArray(data) ? data.filter((d) => d.type !== 'series') : [])
      } catch {
        setHits([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Add to queue…"
          className="w-full bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-500"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" />}
      </div>
      {open && hits.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => { onAdd(h.id, h.title); setQ(''); setHits([]); setOpen(false) }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <Plus className="h-3 w-3 shrink-0 text-emerald-400" />
              <span className="line-clamp-1">{h.title}</span>
              {h.year ? <span className="ml-auto shrink-0 text-zinc-500">{h.year}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function actorVerb(action: LastActor['action']): string {
  switch (action) {
    case 'play':
      return 'started playback'
    case 'pause':
      return 'paused'
    case 'seek':
      return 'skipped'
  }
}

export function PartyPanel({
  joinCode,
  joinUrl,
  members,
  selfUserId,
  hostUserId,
  lastActor,
  waitingFor,
  connectionState,
  onLeave,
  onEnd,
  queue,
  onAddToQueue,
  onRemoveFromQueue,
  onPlayNext,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const isHost = hostUserId != null && selfUserId === hostUserId

  const flashCopied = () => {
    setCopyFailed(false)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const fallbackCopy = (): boolean => {
    try {
      const ta = document.createElement('textarea')
      ta.value = joinUrl
      // Keep it off-screen but still selectable/focusable.
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.top = '-9999px'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  const copyLink = async () => {
    // navigator.clipboard is undefined on non-secure contexts / older mobile webviews.
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(joinUrl)
        flashCopied()
        return
      } catch {
        /* fall through to execCommand fallback */
      }
    }
    if (fallbackCopy()) {
      flashCopied()
      return
    }
    // Surface a visible failure so the user can copy manually.
    setCopied(false)
    setCopyFailed(true)
    setTimeout(() => setCopyFailed(false), 4000)
  }

  const connLabel =
    connectionState === 'connected'
      ? 'Connected'
      : connectionState === 'reconnecting'
        ? 'Reconnecting…'
        : connectionState === 'ended'
          ? 'Party ended'
          : 'Connecting…'

  return (
    <div className="flex flex-col gap-3 p-3 text-zinc-200">
      {/* Header: join code + copy */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Watch party</p>
          <p className="font-mono text-lg font-semibold tracking-widest text-white">{joinCode}</p>
        </div>
        <button
          type="button"
          onClick={copyLink}
          className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-zinc-700"
        >
          {copyFailed ? (
            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
          ) : copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copyFailed ? 'Copy failed' : copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      {/* Manual-copy fallback when clipboard is unavailable */}
      {copyFailed && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] text-red-300">Couldn’t copy automatically — select and copy:</p>
          <input
            type="text"
            readOnly
            value={joinUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full select-all rounded-md bg-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:ring-1 focus:ring-sky-600"
          />
        </div>
      )}

      {/* Connection state */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            connectionState === 'connected'
              ? 'bg-emerald-400'
              : connectionState === 'ended'
                ? 'bg-red-500'
                : 'bg-amber-400 animate-pulse'
          }`}
        />
        <span className="text-zinc-400">{connLabel}</span>
      </div>

      {/* Attribution */}
      {lastActor && (
        <p className="text-[11px] text-zinc-400">
          <span className="font-medium text-zinc-200">{lastActor.displayName}</span>{' '}
          {actorVerb(lastActor.action)}
        </p>
      )}

      {/* Waiting to buffer */}
      {waitingFor.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-300">
          <Loader2 className="h-3 w-3 animate-spin" />
          Waiting for {waitingFor.map((w) => w.displayName).join(', ')} to buffer…
        </p>
      )}

      {/* Member list */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">
          Members ({members.length})
        </p>
        {members.map((m) => {
          const grace = m.connectionState === 'grace'
          return (
            <div key={m.userId} className="flex items-center gap-2 text-sm">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  grace ? 'bg-zinc-600' : m.ready ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                }`}
                title={grace ? 'Reconnecting' : m.ready ? 'Ready' : 'Buffering'}
              />
              <span className={grace ? 'text-zinc-500' : 'text-zinc-200'}>
                {m.displayName}
                {m.userId === selfUserId && ' (you)'}
              </span>
              {m.userId === hostUserId && (
                <Crown className="h-3 w-3 text-amber-400" aria-label="Host" />
              )}
            </div>
          )
        })}
      </div>

      {/* Shared queue (feature 3) */}
      <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Up next ({queue.length})</p>
          {queue.length > 0 && (
            <button
              type="button"
              onClick={onPlayNext}
              className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
              title="Skip to the next queued item now"
            >
              <SkipForward className="h-3 w-3" /> Play next
            </button>
          )}
        </div>

        {queue.length === 0 ? (
          <p className="text-[11px] text-zinc-500">Nothing queued. When this ends, the party stops.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {queue.map((item, i) => (
              <li key={item.id} className="flex items-center gap-2 rounded-md bg-zinc-800/50 px-2 py-1 text-xs">
                <span className="w-4 shrink-0 text-right text-zinc-500">{i + 1}</span>
                <span className="line-clamp-1 flex-1 text-zinc-200" title={item.title}>{item.title}</span>
                <button
                  type="button"
                  onClick={() => onRemoveFromQueue(item.id)}
                  className="shrink-0 text-zinc-600 hover:text-red-400"
                  aria-label={`Remove ${item.title} from queue`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}

        <QueueAdder onAdd={onAddToQueue} />
      </div>

      {/* Controls */}
      <div className="mt-1 flex flex-col gap-2">
        <button
          type="button"
          onClick={onLeave}
          className="flex items-center justify-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-zinc-700"
        >
          <LogOut className="h-3.5 w-3.5" />
          Leave party
        </button>
        {isHost && (
          <button
            type="button"
            onClick={onEnd}
            className="flex items-center justify-center gap-1.5 rounded-md bg-red-900/60 px-3 py-1.5 text-xs text-red-200 transition-colors hover:bg-red-900"
          >
            <X className="h-3.5 w-3.5" />
            End party for everyone
          </button>
        )}
      </div>
    </div>
  )
}
