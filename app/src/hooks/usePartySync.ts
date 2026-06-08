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

const PING_INTERVAL_MS = 10_000
const CHAT_CAP = 200
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
    useState<UsePartySyncResult['connectionState']>('connecting')
  const [ended, setEnded] = useState(false)

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
  const readyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastReadyReportedRef = useRef<boolean | null>(null)
  const closedByUsRef = useRef(false)
  // Late-join two-phase: pending second seek on next canplay, then report ready.
  const pendingPostJoinReseekRef = useRef(false)

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
            v.play().catch(() => {})
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
    [videoRef, withRemoteApply],
  )

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
          applyState(msg)
          break
        case 'reseek': {
          const offset = offsetRef.current
          const localEffectiveAt = msg.effectiveAt - offset
          const fire = () => {
            withRemoteApply(() => {
              const v = videoRef.current
              if (v) v.currentTime = ticksToSeconds(msg.positionTicks)
            })
          }
          const delay = localEffectiveAt - Date.now()
          if (delay <= 0) fire()
          else setTimeout(fire, delay)
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
          setReactions((prev) => [
            ...prev,
            {
              id: `${msg.ts}-${Math.random().toString(36).slice(2, 8)}`,
              from: msg.from,
              emoji: msg.emoji,
              ts: msg.ts,
            },
          ])
          break
        case 'pong': {
          const now = Date.now()
          const roundTrip = now - msg.clientTime
          const sample = msg.serverTime - (msg.clientTime + roundTrip / 2)
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
        case 'error':
          // Non-fatal protocol errors (bad emoji, not a member). Surface via console;
          // the UI shows connection state, and a hard 'not a member' just won't sync.
          console.warn('[party] server error', msg.code, msg.message)
          break
      }
    },
    [applyState, withRemoteApply, videoRef],
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
      // Two-phase late join: on the first canplay after (re)join, re-read the now-
      // current authoritative position and seek there, then report ready.
      if (pendingPostJoinReseekRef.current) {
        pendingPostJoinReseekRef.current = false
        // The next STATE/keepalive will reconcile precisely; here we simply settle
        // and report ready so the gate can release. (We avoid a second hard seek
        // with no fresh snapshot to target.)
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
  }, [enabled, partyId, videoRef, reportReady])

  // -------------------------------------------------------------------------
  // Socket lifecycle: connect, reconnect with backoff, heartbeat, ping.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || !partyId) return

    closedByUsRef.current = false
    setEnded(false)
    let disposed = false

    const clearTimers = () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      heartbeatTimerRef.current = null
      pingTimerRef.current = null
      reconnectTimerRef.current = null
    }

    const startTimers = () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = setInterval(() => {
        const v = videoRef.current
        send({
          type: 'heartbeat',
          partyId,
          positionTicks: Math.round((v?.currentTime ?? 0) * 10_000_000),
          playbackRate: v?.playbackRate ?? 1,
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
        reconnectAttemptRef.current = 0
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
    ended,
    sendIntent,
    sendChat,
    sendReaction,
    expireReaction,
  }
}
