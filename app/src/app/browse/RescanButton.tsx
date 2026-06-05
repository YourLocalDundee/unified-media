'use client'

/**
 * RescanButton — triggers a full media library scan via POST /api/media/scan.
 *
 * Rendered only for admin users (the API enforces requireAdmin() server-side,
 * but we also hide the button from non-admins to avoid confusing 401 errors).
 * Non-admin users simply see nothing rendered.
 */

import { useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

type ScanState = 'idle' | 'scanning' | 'done' | 'error'

export default function RescanButton() {
  const { user, loading } = useAuth()
  const [state, setState] = useState<ScanState>('idle')
  const [resultText, setResultText] = useState<string | null>(null)

  const handleScan = useCallback(async () => {
    if (state === 'scanning') return
    setState('scanning')
    setResultText(null)

    try {
      const res = await fetch('/api/media/scan', { method: 'POST' })
      if (!res.ok) {
        setState('error')
        setResultText('Scan failed')
      } else {
        const data = await res.json() as { scanned?: number; enriched?: number; failed?: number }
        const newItems = data.scanned ?? 0
        setState('done')
        setResultText(
          newItems > 0
            ? `Scan complete — ${newItems} new item${newItems !== 1 ? 's' : ''}`
            : 'Scan complete — no new items'
        )
      }
    } catch {
      setState('error')
      setResultText('Scan failed')
    }

    // Reset after 3 seconds regardless of outcome
    setTimeout(() => {
      setState('idle')
      setResultText(null)
    }, 3000)
  }, [state])

  // Hide while auth is loading or if the user isn't admin
  if (loading || !user || user.role !== 'admin') return null

  const isScanning = state === 'scanning'

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleScan}
        disabled={isScanning}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
          state === 'done'
            ? 'border-green-600 bg-green-950 text-green-400'
            : state === 'error'
            ? 'border-red-600 bg-red-950 text-red-400'
            : 'border-zinc-700 bg-transparent text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
        }`}
        title="Rescan media library"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 flex-shrink-0 ${isScanning ? 'animate-spin' : ''}`}
        />
        {state === 'done'
          ? '✓ Done'
          : state === 'error'
          ? 'Scan failed'
          : isScanning
          ? 'Scanning…'
          : 'Rescan Library'}
      </button>

      {resultText && state !== 'idle' && (
        <p className="text-[11px] text-zinc-500">{resultText}</p>
      )}
    </div>
  )
}
