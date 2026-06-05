'use client'

// Client-side React hooks for qBittorrent.
// These hit the Next.js API proxy routes (/api/qbit/...) — never the qBit daemon
// directly. The browser never sees credentials or the SID cookie.
// useMainData is the primary hook: it polls /api/qbit/sync/maindata every 2s
// and maintains an in-memory torrent map that is patched via incremental deltas.
import { useState, useEffect, useRef, useCallback } from 'react'
import type { MainData, Torrent, TransferInfo } from './types'

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
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
    // retryCount is included so a manual retry triggers a fresh poll cycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll, retryCount])

  return { torrents, transferInfo, isConnected, error, retry }
}

// ---------------------------------------------------------------------------
// Generic action hook
// ---------------------------------------------------------------------------

// Reusable primitive for fire-and-forget torrent actions.
// Posts to the Next.js proxy route; the proxy forwards to qBit with the SID.
// isPending can drive loading spinners; errors are currently not surfaced to the
// caller — the next useMainData poll will reflect the actual state instead.
function useTorrentAction(endpoint: string) {
  const [isPending, setIsPending] = useState(false)

  const execute = useCallback(
    async (body: URLSearchParams) => {
      setIsPending(true)
      try {
        await fetch(`/api/qbit/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
      } finally {
        setIsPending(false)
      }
    },
    [endpoint]
  )

  return { execute, isPending }
}

// ---------------------------------------------------------------------------
// Specific action hooks
// ---------------------------------------------------------------------------

export function usePauseTorrents() {
  const { execute, isPending } = useTorrentAction('torrents/stop')
  const pauseTorrents = useCallback(
    (hashes: string[]) =>
      execute(new URLSearchParams({ hashes: hashes.join('|') })),
    [execute]
  )
  return { pauseTorrents, isPending }
}

export function useResumeTorrents() {
  const { execute, isPending } = useTorrentAction('torrents/start')
  const resumeTorrents = useCallback(
    (hashes: string[]) =>
      execute(new URLSearchParams({ hashes: hashes.join('|') })),
    [execute]
  )
  return { resumeTorrents, isPending }
}

export function useDeleteTorrents() {
  const [isPending, setIsPending] = useState(false)

  const deleteTorrents = useCallback(
    async (hashes: string[], deleteFiles = false) => {
      setIsPending(true)
      try {
        await fetch('/api/qbit/torrents/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            hashes: hashes.join('|'),
            deleteFiles: String(deleteFiles),
          }).toString(),
        })
      } finally {
        setIsPending(false)
      }
    },
    []
  )

  return { deleteTorrents, isPending }
}

export function useAddTorrent() {
  const [isPending, setIsPending] = useState(false)

  const addTorrent = useCallback(async (urls: string, category?: string) => {
    setIsPending(true)
    try {
      const body = new URLSearchParams({ urls })
      if (category) body.set('category', category)
      await fetch('/api/qbit/torrents/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    } finally {
      setIsPending(false)
    }
  }, [])

  return { addTorrent, isPending }
}
