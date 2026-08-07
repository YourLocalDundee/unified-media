'use client'

// Client-side React hooks for qBittorrent.
// These hit the Next.js API proxy routes (/api/qbit/...) — never the qBit daemon
// directly. The browser never sees credentials or the SID cookie.
// useMainData is the primary hook: it polls /api/qbit/sync/maindata and maintains
// an in-memory torrent map that is patched via incremental deltas. The poll
// interval honors the user's configurable refreshInterval (A7-13) and pauses
// while the document is hidden.
import { useState, useEffect, useRef, useCallback } from 'react'
import type { MainData, Torrent, TransferInfo, CreateTorrentParams, TorrentCreationTask } from './types'

// A7-13: read the user's configurable refresh interval from the same localStorage
// key the Torrent settings UI writes (TorrentUIPreferences.refreshInterval).
// Falls back to 2000ms (the prior hardcoded value) on any read failure.
const TORRENT_PREFS_KEY = 'unified-torrent-prefs'
const DEFAULT_REFRESH_INTERVAL = 2000

function readRefreshInterval(): number {
  if (typeof window === 'undefined') return DEFAULT_REFRESH_INTERVAL
  try {
    const raw = localStorage.getItem(TORRENT_PREFS_KEY)
    if (!raw) return DEFAULT_REFRESH_INTERVAL
    const parsed = JSON.parse(raw) as { refreshInterval?: number }
    const v = parsed.refreshInterval
    return typeof v === 'number' && v > 0 ? v : DEFAULT_REFRESH_INTERVAL
  } catch {
    return DEFAULT_REFRESH_INTERVAL
  }
}

// ---------------------------------------------------------------------------
// useMainData — primary real-time polling hook
// ---------------------------------------------------------------------------

export function useMainData(): {
  torrents: Torrent[]
  transferInfo: TransferInfo | null
  isConnected: boolean
  error: string | null
  retry: () => void
} {
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const [transferInfo, setTransferInfo] = useState<TransferInfo | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ridRef persists across renders without causing re-renders; it is not state.
  // rid=0 tells the server to return a full_update (the initial snapshot).
  const ridRef = useRef(0)
  // torrentMapRef is mutated in place; Object.values() produces the array for React state.
  const torrentMapRef = useRef<Record<string, Torrent>>({})
  // Increment to trigger an immediate re-poll on demand
  const [retryCount, setRetryCount] = useState(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/qbit/sync/maindata?rid=${ridRef.current}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MainData = await res.json()

      // Thread the rid back on the next request so the server returns only the delta.
      ridRef.current = data.rid

      if (data.full_update) {
        // Server signalled a full replace (first poll, or server restart).
        torrentMapRef.current = (data.torrents ?? {}) as Record<string, Torrent>
      } else {
        // Merge delta — only the changed fields are present in each partial entry.
        if (data.torrents) {
          for (const [hash, partial] of Object.entries(data.torrents)) {
            torrentMapRef.current[hash] = {
              ...torrentMapRef.current[hash],
              ...partial,
            } as Torrent
          }
        }
        if (data.torrents_removed) {
          for (const hash of data.torrents_removed) {
            delete torrentMapRef.current[hash]
          }
        }
      }

      const torrentList = Object.entries(torrentMapRef.current).map(
        ([hash, t]) => ({ ...t, hash })
      )
      setTorrents(torrentList)

      if (data.server_state) {
        setTransferInfo(data.server_state as TransferInfo)
      }

      setIsConnected(true)
      setError(null)
    } catch (e) {
      setIsConnected(false)
      setError(String(e))
      // Reset rid so the next successful poll triggers a full_update and
      // rebuilds the torrent map from scratch rather than applying a delta.
      ridRef.current = 0
    }
  }, [])

  const retry = useCallback(() => {
    ridRef.current = 0
    torrentMapRef.current = {}
    setError(null)
    setRetryCount((n) => n + 1)
  }, [])

  useEffect(() => {
    // A7-13: configurable interval + pause while the tab is hidden so a
    // backgrounded downloads page does not poll qBit (and the proxy) every tick.
    let interval: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (interval !== null) return
      interval = setInterval(poll, readRefreshInterval())
    }
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval)
        interval = null
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        // Refresh immediately on return so the view is not stale, then resume.
        poll()
        start()
      }
    }

    // Initial poll + start only if the tab is currently visible.
    if (!document.hidden) {
      poll()
      start()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // retryCount is included so a manual retry triggers a fresh poll cycle
  }, [poll, retryCount])

  return { torrents, transferInfo, isConnected, error, retry }
}

// ---------------------------------------------------------------------------
// Generic action hook
// ---------------------------------------------------------------------------

// Reusable primitive for torrent actions.
// Posts to the Next.js proxy route; the proxy forwards to qBit with the SID.
// isPending can drive loading spinners. A7-04: the response is now checked for
// res.ok — a non-2xx throws so the caller can surface it (error is also exposed
// here). execute re-throws so callers awaiting it can branch on success/failure.
function useTorrentAction(endpoint: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(
    async (body: URLSearchParams) => {
      setIsPending(true)
      setError(null)
      try {
        const res = await fetch(`/api/qbit/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
        // A7-04: a failed mutation must not report success.
        if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        throw e
      } finally {
        setIsPending(false)
      }
    },
    [endpoint]
  )

  return { execute, isPending, error }
}

// ---------------------------------------------------------------------------
// Specific action hooks
// ---------------------------------------------------------------------------

export function usePauseTorrents() {
  const { execute, isPending, error } = useTorrentAction('torrents/stop')
  const pauseTorrents = useCallback(
    (hashes: string[]) =>
      execute(new URLSearchParams({ hashes: hashes.join('|') })),
    [execute]
  )
  return { pauseTorrents, isPending, error }
}

export function useResumeTorrents() {
  const { execute, isPending, error } = useTorrentAction('torrents/start')
  const resumeTorrents = useCallback(
    (hashes: string[]) =>
      execute(new URLSearchParams({ hashes: hashes.join('|') })),
    [execute]
  )
  return { resumeTorrents, isPending, error }
}

export function useDeleteTorrents() {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const deleteTorrents = useCallback(
    async (hashes: string[], deleteFiles = false) => {
      setIsPending(true)
      setError(null)
      try {
        const res = await fetch('/api/qbit/torrents/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            hashes: hashes.join('|'),
            deleteFiles: String(deleteFiles),
          }).toString(),
        })
        // A7-04: surface a failed delete instead of silently reporting success.
        if (!res.ok) throw new Error(`Delete failed (HTTP ${res.status})`)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        throw e
      } finally {
        setIsPending(false)
      }
    },
    []
  )

  return { deleteTorrents, isPending, error }
}

export function useAddTorrent() {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addTorrent = useCallback(async (urls: string, category?: string) => {
    setIsPending(true)
    setError(null)
    try {
      const body = new URLSearchParams({ urls })
      if (category) body.set('category', category)
      const res = await fetch('/api/qbit/torrents/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      // A7-04: a failed add must not clear/close the form (caller awaits this).
      if (!res.ok) throw new Error(`Add failed (HTTP ${res.status})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setIsPending(false)
    }
  }, [])

  return { addTorrent, isPending, error }
}

// ---------------------------------------------------------------------------
// useCreateTorrentTask — qBittorrent 5.x async torrent-creation task
// ---------------------------------------------------------------------------
// POST /torrentcreator/addTask only queues the job and returns {taskID}; the
// actual hashing happens server-side. We poll GET /torrentcreator/status?
// taskID=... until the task's status is Finished or Failed. See the
// CreateTorrentParams / TorrentCreationTask doc comments in ./types for the
// full endpoint contract (verified against qBittorrent's
// TorrentCreatorController source — scope is "torrentcreator", not "torrents").

export type CreateTorrentUIStatus =
  | 'idle'
  | 'submitting'  // initial addTask request in flight
  | 'polling'     // task queued/running, waiting on the next status poll
  | 'finished'
  | 'failed'      // task reached a terminal Failed state (server-reported)
  | 'error'       // a network/proxy error either submitting or polling

const POLL_INTERVAL_MS = 1500

async function fetchTaskStatus(taskId: string): Promise<TorrentCreationTask> {
  const res = await fetch(`/api/qbit/torrentcreator/status?taskID=${encodeURIComponent(taskId)}`)
  if (!res.ok) throw new Error(`Status check failed (HTTP ${res.status})`)
  const data = (await res.json()) as TorrentCreationTask[] | TorrentCreationTask
  const task = Array.isArray(data) ? data[0] : data
  if (!task) throw new Error('Task not found — it may have expired on the qBittorrent side.')
  return task
}

export function useCreateTorrentTask() {
  const [uiStatus, setUIStatus] = useState<CreateTorrentUIStatus>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [task, setTask] = useState<TorrentCreationTask | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Polls while a task is outstanding; stops itself once the task reaches a
  // terminal state or the caller clears taskId (reset()).
  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = () => {
      fetchTaskStatus(taskId)
        .then((t) => {
          if (cancelled) return
          setTask(t)
          if (t.status === 'Finished') { setUIStatus('finished'); return }
          if (t.status === 'Failed') { setUIStatus('failed'); return }
          setUIStatus('polling')
          timer = setTimeout(tick, POLL_INTERVAL_MS)
        })
        .catch((e) => {
          if (cancelled) return
          setUIStatus('error')
          setSubmitError(e instanceof Error ? e.message : String(e))
        })
    }

    // Deferred a tick so the first poll's setState doesn't run synchronously in
    // the effect's commit path (react-hooks/set-state-in-effect); the recurring
    // ticks are already deferred via their own setTimeout scheduling above.
    timer = setTimeout(tick, 0)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [taskId])

  const submit = useCallback(async (params: CreateTorrentParams) => {
    setUIStatus('submitting')
    setSubmitError(null)
    setTask(null)
    setTaskId(null)

    const body = new URLSearchParams()
    body.set('sourcePath', params.sourcePath)
    if (params.trackers && params.trackers.length > 0) body.set('trackers', params.trackers.join('\n'))
    if (params.urlSeeds && params.urlSeeds.length > 0) body.set('urlSeeds', params.urlSeeds.join('\n'))
    if (params.private !== undefined) body.set('private', String(params.private))
    if (params.comment) body.set('comment', params.comment)
    if (params.source) body.set('source', params.source)
    if (params.startSeeding !== undefined) body.set('startSeeding', String(params.startSeeding))
    if (params.pieceSize) body.set('pieceSize', String(params.pieceSize))

    try {
      const res = await fetch('/api/qbit/torrentcreator/addTask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
        throw new Error(errJson?.error ?? errJson?.message ?? `Create failed (HTTP ${res.status})`)
      }
      const data = (await res.json()) as { taskID?: string }
      if (!data.taskID) throw new Error('qBittorrent did not return a task ID.')
      setTaskId(data.taskID)
    } catch (e) {
      setUIStatus('error')
      setSubmitError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }, [])

  const reset = useCallback(() => {
    setTaskId(null)
    setTask(null)
    setSubmitError(null)
    setUIStatus('idle')
  }, [])

  return { uiStatus, task, submitError, submit, reset }
}
