'use client'

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
  const ridRef = useRef(0)
  const torrentMapRef = useRef<Record<string, Torrent>>({})
  // Increment to trigger an immediate re-poll on demand
  const [retryCount, setRetryCount] = useState(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/qbit/sync/maindata?rid=${ridRef.current}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MainData = await res.json()

      ridRef.current = data.rid

      if (data.full_update) {
        // Full replace
        torrentMapRef.current = (data.torrents ?? {}) as Record<string, Torrent>
      } else {
        // Merge delta
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
      ridRef.current = 0 // reset for full re-sync on recovery
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
