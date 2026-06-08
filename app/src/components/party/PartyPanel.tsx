'use client'

/**
 * PartyPanel — the party side panel: join code + copy-link, member list with
 * ready/connection indicators and host badge, an attribution line from lastActor,
 * a "waiting to buffer" line, and leave / end controls.
 */

import { useState } from 'react'
import { Copy, Check, LogOut, X, Crown, Loader2, AlertCircle } from 'lucide-react'
import type { MemberSummary, LastActor } from '@/lib/party/types'

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
