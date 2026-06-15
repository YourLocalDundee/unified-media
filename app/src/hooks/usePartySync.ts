'use client'

/**
 * usePartySync — the client side of Party Play.
 *
 * Maintains a reconnecting WebSocket to the party server, heartbeats position,
 * estimates clock offset, reports readiness, and (the critical part) APPLIES
 * authoritative server state to the <video> element. It never derives intents
 * from the element's own events — intents come exclusively from the user-action
 * surfaces in VideoPlayer, which call sendIntent. While the hook programmatically
 * mutates the video it raises applyingRemoteStateRef so those side-effect element
 * events are recognised as remote, not user.
 *
 * See PARTY_PLAY_SPEC.txt "CLIENT INTEGRATION (THE PLAYER)" and
 * "THE THREE ACTION ORIGINS".
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getPartySocketUrl } from '@/lib/party/socket-url'
import { extrapolatePosition, ticksToSeconds } from '@/lib/party/position'
import {
  HEARTBEAT_INTERVAL_MS,
  CLOCK_OFFSET_EMA_ALPHA,
  SEEK_DEADBAND_S,
  RATE_NUDGE_LOW_S,
  DRIFT_HARD_RESEEK_S,
  RATE_NUDGE_CLAMP,
  POST_JOIN_SETTLE_MS,
} from '@/lib/party/constants'
import type {
  ServerMessage,
  ClientMessage,
  ControlAction,
  MemberSummary,
  ChatMessageDTO,
  LastActor,
} from '@/lib/party/types'

// Match the 5s heartbeat cadence (A5-10) so the clock-offset EMA — which is fed only by
// pong replies — refreshes as often as the spec intends, not half as often.
const PING_INTERVAL_MS = 5_000
const CHAT_CAP = 200
// Cap how many reaction floaters can be on screen at once (A5-12). Reactions are
// rate-limited per sender but not coalesced, so several spammers can stack dozens of
// floaters; keep only the most recent so the corner column can't fill the screen.
const REACTION_RENDER_CAP = 12
const READY_DEBOUNCE_MS = 400
const RECONNECT_BACKOFF_MS = [0, 1000, 2000, 5000]

export interface PartyReaction {
  id: string
  from: { userId: string; displayName: string }
  emoji: string
  ts: number
}

export interface UsePartySyncResult {
  connected: boolean
  members: MemberSummary[]
  lastActor: LastActor | null
  waitingFor: { userId: string; displayName: string }[]
  paused: boolean
  chatMessages: ChatMessageDTO[]
  reactions: PartyReaction[]
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'ended'
  /** Raised by the hook while it programmatically mutates the video. VideoPlayer
   *  reads it so element-event handlers know the change was remote. */
  applyingRemoteStateRef: React.RefObject<boolean>
  /** Last user-facing server error (rate-limited / not-a-member / bad reaction),
   *  auto-clears after a few seconds. Lets the panel show why a chat/reaction was
   *  dropped instead of failing silently (A5-06). */
  lastError: string | null
  ended: boolean
  sendIntent: (action: ControlAction, positionTicks: number) => void
  sendChat: (text: string) => void
  sendReaction: (emoji: string) => void
  expireReaction: (id: string) => void
}

interface UsePartySyncOpts {
  videoRef: React.RefObject<HTMLVideoElement | null>
  selfUserId: string
  enabled: boolean
}

export function usePartySync(
  partyId: string | null,
  opts: UsePartySyncOpts,
): UsePartySyncResult {
  const { videoRef, enabled } = opts

  // --- React-visible state (drives UI) ---
  const [connected, setConnected] = useState(false)
  const [members, setMembers] = useState<MemberSummary[]>([])
  const [lastActor, setLastActor] = useState<LastActor | null>(null)
  const [waitingFor, setWaitingFor] = useState<{ userId: string; displayName: string }[]>([])
  const [paused, setPaused] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMessageDTO[]>([])
  const [reactions, setReactions] = useState<PartyReaction[]>([])
  const [connectionState, setConnectionState] =
    useState<UsePartySyncResult['connectionState']>(
      // L10: a disabled (non-party) instance has no socket to connect — start idle,
      // not stuck on 'connecting' forever.
      enabled && partyId ? 'connecting' : 'ended',
    )
  const [ended, setEnded] = useState(false)
  // Transient, user-facing server error surfaced to the panel (A5-06).
  const [lastError, setLastError] = useState<string | null>(null)
  const errorClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Refs (live values, not re-render triggers) ---
  const wsRef = useRef<WebSocket | null>(null)
  const applyingRemoteStateRef = useRef(false)
  const offsetRef = useRef(0) // serverTime - localTime estimate, ms
  const lastJoinAtRef = useRef(0) // local ms when we last (re)joined — gates hard reseek
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // H6: the reseek macrotask, tracked so it can be cleared on reschedule/unmount.
  const reseekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastReadyReportedRef = useRef<boolean | null>(null)
  const closedByUsRef = useRef(false)
  // Late-join two-phase: pending second seek on next canplay, then report ready.
  const pendingPostJoinReseekRef = useRef(false)
  // H7: the last authoritative snapshot we applied, retained so the two-phase
  // late-join canplay handler can re-extrapolate it to `now` and seek again.
  const lastSnapshotRef = useRef<{
    positionTicks: number
    paused: boolean
    playbackRate: number
    serverTime: number
  } | null>(null)
  // M6/M7: the room's intended (authoritative) playback rate — the last
  // msg.playbackRate adopted in applyState. The heartbeat reports THIS, not the
  // transiently nudged video.playbackRate, and the heartbeat tick lifts a stale
  // nudge back to this rate once we are inside the deadband.
  const authoritativeRateRef = useRef(1)
  // M5: timer that confirms a freshly-opened socket has stayed open long enough
  // to be considered stable, at which point the reconnect counter is reset.
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  // -------------------------------------------------------------------------
  // Programmatic mutation helpers — always run inside applyingRemoteStateRef.
  // -------------------------------------------------------------------------

  const withRemoteApply = useCallback((fn: () => void) => {
    applyingRemoteStateRef.current = true
    try {
      fn()
    } finally {
      // Reset on a microtask so element events fired synchronously by the
      // mutation (play/pause/seeking) still see the flag raised.
      queueMicrotask(() => {
        applyingRemoteStateRef.current = false
      })
    }
  }, [])

  // M8 — robust remote play. The microtask reset in withRemoteApply covers element
  // events fired synchronously by the mutation, but a remote-applied play resolves
  // its play() promise on a LATER macrotask, and the 'playing' event can fire then —
  // after the microtask has already lowered the flag — and be mistaken for a user
  // action. Keep the flag raised until the play() promise settles as well (defense
  // in depth; the player never derives intents from element events regardless).
  const playRemote = useCallback((v: HTMLVideoElement) => {
    applyingRemoteStateRef.current = true
    const lower = () => {
      applyingRemoteStateRef.current = false
    }
    v.play().then(lower).catch(lower)
  }, [])

  // Extrapolate the retained authoritative snapshot to `now + offset` content time.
  // Used by the two-phase late-join second seek (H7) and the heartbeat-tick nudge
  // restoration (M7). Returns null if there is no snapshot yet.
  const extrapolateLiveTargetSec = useCallback((): number | null => {
    const snap = lastSnapshotRef.current
    if (!snap) return null
    const liveTicks = extrapolatePosition(
      {
        positionTicks: snap.positionTicks,
        paused: snap.paused,
        playbackRate: snap.playbackRate,
        lastTickWallClock: snap.serverTime,
      },
      Date.now() + offsetRef.current,
    )
    return ticksToSeconds(liveTicks)
  }, [])

  // -------------------------------------------------------------------------
  // Apply an authoritative STATE snapshot to the player.
  // -------------------------------------------------------------------------

  const applyState = useCallback(
    (msg: Extract<ServerMessage, { type: 'state' }>) => {
      const video = videoRef.current
      if (!video) return

      const offset = offsetRef.current
      const localNow = Date.now()

      // Update UI-facing state immediately (members/actor/paused); the transition
      // (actual play/pause/seek) fires at effectiveAt - offset, re-extrapolating the
      // authoritative position live at that moment.
      setMembers(msg.members)
      setLastActor(msg.lastActor)
      setPaused(msg.paused)
      setWaitingFor([])

      // M6/M7 + H7: adopt the room's authoritative rate and retain the snapshot so
      // the heartbeat reports the room rate (not a transient nudge), the tick can
      // restore the rate, and the two-phase canplay handler can re-seek.
      authoritativeRateRef.current = msg.playbackRate
      lastSnapshotRef.current = {
        positionTicks: msg.positionTicks,
        paused: msg.paused,
        playbackRate: msg.playbackRate,
        serverTime: msg.serverTime,
      }

      const withinSettle = localNow - lastJoinAtRef.current < POST_JOIN_SETTLE_MS

      const doTransition = () => {
        const v = videoRef.current
        if (!v) return
        // Re-extrapolate at the actual fire time so any scheduling delay is absorbed.
        const fireNow = Date.now()
        const liveTicks = extrapolatePosition(
          {
            positionTicks: msg.positionTicks,
            paused: msg.paused,
            playbackRate: msg.playbackRate,
            lastTickWallClock: msg.serverTime,
          },
          fireNow + offsetRef.current,
        )
        const liveTargetSec = ticksToSeconds(liveTicks)

        withRemoteApply(() => {
          // 1) Reconcile position.
          const drift = v.currentTime - liveTargetSec // +ahead, -behind
          const absDrift = Math.abs(drift)
          if (absDrift >= SEEK_DEADBAND_S) {
            if (absDrift >= DRIFT_HARD_RESEEK_S && !withinSettle) {
              // Hard reseek (suppressed during the post-join settle window).
              v.currentTime = liveTargetSec
              v.playbackRate = msg.playbackRate
            } else if (absDrift >= RATE_NUDGE_LOW_S) {
              // Rate nudge: behind => speed up, ahead => slow down. Magnitude
              // scales with drift, clamped to [1-clamp, 1+clamp].
              const span = DRIFT_HARD_RESEEK_S - RATE_NUDGE_LOW_S
              const frac = Math.min(1, (absDrift - RATE_NUDGE_LOW_S) / span)
              const magnitude = RATE_NUDGE_CLAMP * frac
              const nudge = drift < 0 ? 1 + magnitude : 1 - magnitude
              v.playbackRate = nudge
            } else {
              // In [deadband, low) — too small to nudge, just restore rate.
              v.playbackRate = msg.playbackRate
            }
          } else {
            // Inside the deadband: restore normal rate.
            v.playbackRate = msg.playbackRate
          }

          // 2) Reconcile play/pause.
          if (msg.paused && !v.paused) {
            v.pause()
          } else if (!msg.paused && v.paused) {
            // M8: keep applyingRemoteStateRef raised until play() settles (its
            // 'playing' event may fire on a later macrotask).
            playRemote(v)
          }
        })
      }

      // Schedule at effectiveAt - offset (local clock). Past => apply now.
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
      const localEffectiveAt = msg.effectiveAt - offset
      const delay = localEffectiveAt - localNow
      if (delay <= 0) {
        doTransition()
      } else {
        transitionTimerRef.current = setTimeout(doTransition, delay)
      }
    },
    [videoRef, withRemoteApply, playRemote],
  )

  // -------------------------------------------------------------------------
  // Connection-stability gate (M5).
  // -------------------------------------------------------------------------

  // M5: do NOT reset the reconnect counter synchronously in onopen — a socket that
  // opens then immediately closes would then reconnect on a tight 0ms loop. Reset
  // only once the connection has proven stable: the first state/pong, or after the
  // socket has stayed open for a few seconds (see the stableTimerRef in connect()).
  const markConnectionStable = useCallback(() => {
    if (stableTimerRef.current) {
      clearTimeout(stableTimerRef.current)
      stableTimerRef.current = null
    }
    reconnectAttemptRef.current = 0
  }, [])

  // -------------------------------------------------------------------------
  // Message dispatch.
  // -------------------------------------------------------------------------

  const handleMessage = useCallback(
    (raw: string) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(raw) as ServerMessage
      } catch {
        return
      }

      switch (msg.type) {
        case 'state':
          // M5: a real state snapshot proves the connection is stable.
          markConnectionStable()
          applyState(msg)
          break
        case 'reseek': {
          const offset = offsetRef.current
          const localEffectiveAt = msg.effectiveAt - offset
          const fire = () => {
            reseekTimerRef.current = null
            withRemoteApply(() => {
              const v = videoRef.current
              if (v) v.currentTime = ticksToSeconds(msg.positionTicks)
            })
          }
          // H6: track and clear so a pending reseek can never fire into a torn-down
          // or replaced <video>, and so it cannot leak past unmount/reconnect.
          if (reseekTimerRef.current) clearTimeout(reseekTimerRef.current)
          const delay = localEffectiveAt - Date.now()
          if (delay <= 0) {
            reseekTimerRef.current = null
            fire()
          } else {
            reseekTimerRef.current = setTimeout(fire, delay)
          }
          break
        }
        case 'waiting':
          setWaitingFor(msg.waitingFor)
          break
        case 'chat':
          setChatMessages((prev) => {
            const next = [
              ...prev,
              { id: msg.id, from: msg.from, text: msg.text, ts: msg.ts },
            ]
            return next.length > CHAT_CAP ? next.slice(next.length - CHAT_CAP) : next
          })
          break
        case 'chat_backlog':
          setChatMessages(
            msg.messages.map((m) => ({ id: m.id, from: m.from, text: m.text, ts: m.ts })),
          )
          break
        case 'reaction':
          setReactions((prev) => {
            const next = [
              ...prev,
              {
                // M16: guaranteed-unique id so same-millisecond reactions cannot
                // collide (which caused stuck/dropped reactions and React key warnings).
                id: crypto.randomUUID(),
                from: msg.from,
                emoji: msg.emoji,
                ts: msg.ts,
              },
            ]
            // A5-12: bound concurrent floaters (their per-id expiry timers in
            // ReactionOverlay reconcile and clear when an id drops off the array).
            return next.length > REACTION_RENDER_CAP ? next.slice(next.length - REACTION_RENDER_CAP) : next
          })
          break
        case 'pong': {
          const now = Date.now()
          const roundTrip = now - msg.clientTime
          // L9: discard malformed/implausible samples (a wild echoed clientTime
          // yields a negative or huge round-trip) before feeding the EMA, so a bad
          // sample cannot poison the clock-offset estimate.
          if (
            !Number.isFinite(roundTrip) ||
            roundTrip < 0 ||
            roundTrip > 5000 ||
            !Number.isFinite(msg.serverTime)
          ) {
            break
          }
          const sample = msg.serverTime - (msg.clientTime + roundTrip / 2)
          // M5: a successful pong proves the connection is live — confirm stability
          // so the reconnect counter can reset (see the stability gate in onopen).
          markConnectionStable()
          offsetRef.current =
            (1 - CLOCK_OFFSET_EMA_ALPHA) * offsetRef.current + CLOCK_OFFSET_EMA_ALPHA * sample
          break
        }
        case 'party_ended':
          setEnded(true)
          setConnectionState('ended')
          closedByUsRef.current = true
          wsRef.current?.close()
          break
        case 'error': {
          // Non-fatal protocol errors (rate-limited, bad emoji, not a member). Surface
          // user-facing ones to the panel so a dropped chat/reaction isn't silent (A5-06);
          // everything still logs to console.
          console.warn('[party] server error', msg.code, msg.message)
          const USER_FACING: Record<string, string> = {
            rate_limited: 'Slow down — too many messages.',
            not_member: 'You are no longer in this party.',
            bad_reaction: 'That reaction could not be sent.',
            bad_field: 'Message could not be sent.',
          }
          const friendly = USER_FACING[msg.code]
          if (friendly) {
            setLastError(friendly)
            if (errorClearTimerRef.current) clearTimeout(errorClearTimerRef.current)
            errorClearTimerRef.current = setTimeout(() => setLastError(null), 4000)
          }
          break
        }
      }
    },
    [applyState, withRemoteApply, videoRef, markConnectionStable],
  )

  // -------------------------------------------------------------------------
  // Readiness reporting (debounced, deduped).
  // -------------------------------------------------------------------------

  const reportReady = useCallback(
    (ready: boolean) => {
      if (!partyId) return
      if (readyDebounceRef.current) clearTimeout(readyDebounceRef.current)
      readyDebounceRef.current = setTimeout(() => {
        if (lastReadyReportedRef.current === ready) return
        lastReadyReportedRef.current = ready
        send({ type: 'ready', partyId, ready })
      }, READY_DEBOUNCE_MS)
    },
    [partyId, send],
  )

  // -------------------------------------------------------------------------
  // Player event listeners: drive readiness + the two-phase late-join reseek.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || !partyId) return
    const video = videoRef.current
    if (!video) return

    const onCanPlay = () => {
      // H7 — two-phase late join. On the first canplay after (re)join we have an
      // authoritative snapshot retained from the join state. The first seek (to the
      // snapshot position) already began buffering; the startup/transcode time that
      // elapsed since then has left us behind, so re-extrapolate that snapshot to NOW
      // and seek there BEFORE reporting ready, so the gate releases on the correct
      // position rather than the stale one. (Spec: "Late-joiner two-phase sync".)
      if (pendingPostJoinReseekRef.current) {
        pendingPostJoinReseekRef.current = false
        const liveTargetSec = extrapolateLiveTargetSec()
        if (liveTargetSec !== null) {
          withRemoteApply(() => {
            const v = videoRef.current
            if (v) v.currentTime = liveTargetSec
          })
        }
        // Only now, after the second seek, do we report ready.
        reportReady(true)
      } else {
        reportReady(true)
      }
    }
    const onPlaying = () => reportReady(true)
    const onWaiting = () => reportReady(false)
    const onStalled = () => reportReady(false)

    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('stalled', onStalled)
    return () => {
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onStalled)
    }
  }, [enabled, partyId, videoRef, reportReady, withRemoteApply, extrapolateLiveTargetSec])

  // -------------------------------------------------------------------------
  // Socket lifecycle: connect, reconnect with backoff, heartbeat, ping.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || !partyId) {
      // L10 — a disabled (non-party) instance has no socket; resolve the state to a
      // settled value instead of leaving it stuck reporting 'connecting'/'connected'.
      setConnected(false)
      setConnectionState('ended')
      return
    }

    closedByUsRef.current = false
    setEnded(false)
    let disposed = false

    const clearTimers = () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      // M5 — a socket that closed before proving stable must not later reset the
      // reconnect counter, so clear the pending stability timer too.
      if (stableTimerRef.current) clearTimeout(stableTimerRef.current)
      heartbeatTimerRef.current = null
      pingTimerRef.current = null
      reconnectTimerRef.current = null
      stableTimerRef.current = null
    }

    const startTimers = () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = setInterval(() => {
        const v = videoRef.current

        // M7 — promptly lift a stale rate-nudge. The nudge is applied in applyState
        // when STATE arrives, but STATE may be up to KEEPALIVE_STATE_BROADCAST_MS
        // (10s) away; without this the client overshoots and sawtooths. Each tick,
        // compare our local position against the extrapolated authoritative position
        // and, if we are back inside the deadband while the rate is still nudged off
        // the room rate, restore the room (authoritative) rate immediately.
        if (v) {
          const liveTargetSec = extrapolateLiveTargetSec()
          const authRate = authoritativeRateRef.current
          if (
            liveTargetSec !== null &&
            v.playbackRate !== authRate &&
            Math.abs(v.currentTime - liveTargetSec) < SEEK_DEADBAND_S
          ) {
            withRemoteApply(() => {
              const vv = videoRef.current
              if (vv) vv.playbackRate = authRate
            })
          }
        }

        send({
          type: 'heartbeat',
          partyId,
          positionTicks: Math.round((v?.currentTime ?? 0) * 10_000_000),
          // M6 — report the ROOM's intended rate, not the transiently nudged
          // video.playbackRate, so the server's drift math is not fed our own nudge.
          playbackRate: authoritativeRateRef.current,
          clientTime: Date.now(),
        })
      }, HEARTBEAT_INTERVAL_MS)

      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      pingTimerRef.current = setInterval(() => {
        send({ type: 'ping', partyId, clientTime: Date.now() })
      }, PING_INTERVAL_MS)
    }

    const connect = () => {
      if (disposed) return
      const url = getPartySocketUrl()
      if (!url) return
      setConnectionState(reconnectAttemptRef.current === 0 ? 'connecting' : 'reconnecting')

      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        if (disposed) return
        // M5 — do NOT reset reconnectAttemptRef here. A socket that opens then
        // immediately closes would otherwise reconnect on a tight 0ms loop. Reset
        // only after the connection proves stable: the first state/pong (via
        // markConnectionStable) OR after staying open for a few seconds (this timer).
        if (stableTimerRef.current) clearTimeout(stableTimerRef.current)
        stableTimerRef.current = setTimeout(() => {
          stableTimerRef.current = null
          reconnectAttemptRef.current = 0
        }, 3000)
        lastJoinAtRef.current = Date.now()
        lastReadyReportedRef.current = null
        pendingPostJoinReseekRef.current = true
        setConnected(true)
        setConnectionState('connected')
        // (Re)join — server replies with the full state snapshot + chat backlog,
        // which we adopt wholesale.
        send({ type: 'join', partyId })
        // Prime the clock offset immediately.
        send({ type: 'ping', partyId, clientTime: Date.now() })
        startTimers()
      }

      ws.onmessage = (ev) => handleMessage(typeof ev.data === 'string' ? ev.data : '')

      ws.onclose = () => {
        if (disposed) return
        setConnected(false)
        clearTimers()
        if (closedByUsRef.current) {
          setConnectionState('ended')
          return
        }
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose follows; reconnect is handled there.
      }
    }

    const scheduleReconnect = () => {
      if (disposed || closedByUsRef.current) return
      setConnectionState('reconnecting')
      const attempt = reconnectAttemptRef.current
      const delay =
        RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]
      reconnectAttemptRef.current = attempt + 1
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      disposed = true
      closedByUsRef.current = true
      clearTimers()
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current)
      // H6 — clear the tracked reseek timer alongside the transition timer so a
      // pending reseek cannot fire into a torn-down or replaced <video>, and cannot leak.
      if (reseekTimerRef.current) {
        clearTimeout(reseekTimerRef.current)
        reseekTimerRef.current = null
      }
      if (readyDebounceRef.current) clearTimeout(readyDebounceRef.current)
      const ws = wsRef.current
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'leave', partyId }))
        } catch {
          /* ignore */
        }
        ws.close()
      }
      wsRef.current = null
      setConnected(false)
    }
    // handleMessage / send are stable (useCallback); re-run only on partyId/enabled change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, partyId])

  // -------------------------------------------------------------------------
  // Outbound user actions.
  // -------------------------------------------------------------------------

  const sendIntent = useCallback(
    (action: ControlAction, positionTicks: number) => {
      if (!partyId) return
      send({ type: 'control', partyId, action, positionTicks, clientTime: Date.now() })
    },
    [partyId, send],
  )

  const sendChat = useCallback(
    (text: string) => {
      if (!partyId) return
      const trimmed = text.trim()
      if (!trimmed) return
      send({ type: 'chat', partyId, text: trimmed })
    },
    [partyId, send],
  )

  const sendReaction = useCallback(
    (emoji: string) => {
      if (!partyId) return
      send({ type: 'reaction', partyId, emoji })
    },
    [partyId, send],
  )

  const expireReaction = useCallback((id: string) => {
    setReactions((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return {
    connected,
    members,
    lastActor,
    waitingFor,
    paused,
    chatMessages,
    reactions,
    connectionState,
    applyingRemoteStateRef,
    lastError,
    ended,
    sendIntent,
    sendChat,
    sendReaction,
    expireReaction,
  }
}
