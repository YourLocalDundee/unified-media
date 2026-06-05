'use client'
import { useState } from 'react'

export default function ApproveButton({ requestId }: { requestId: number }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function approve() {
    setStatus('loading')
    const res = await fetch(`/api/requests/${requestId}/approve`, { method: 'POST' })
    setStatus(res.ok ? 'done' : 'error')
  }

  if (status === 'done') return <span className="text-xs text-green-400">Approved</span>
  if (status === 'error') return <span className="text-xs text-red-400">Failed</span>
  return (
    <button onClick={approve} disabled={status === 'loading'}
      className="rounded px-2 py-1 text-xs font-medium bg-green-900/50 text-green-300 hover:bg-green-800/60 disabled:opacity-50">
      {status === 'loading' ? '…' : 'Approve'}
    </button>
  )
}
