'use client'

/**
 * LibraryItemAdminMenu — admin-only corner control on a /library/[id] detail page (Part C).
 * A gear button opens a small menu whose one action, "Delete from server", opens a
 * confirm modal and then DELETE /api/admin/media/[id] — which removes the title from
 * disk, the download client, and the database. On success it redirects to /library.
 *
 * The parent only renders this for admins; it has no client-side privilege of its own
 * (the API re-checks requireAdmin + verifyOrigin).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Settings, Trash2, Loader2, X, AlertTriangle } from 'lucide-react'
import { ModalPortal } from '@/components/ui/ModalPortal'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface Props {
  itemId: string
  title: string
}

interface PurgeResult {
  filesDeleted?: number
  torrentsDeleted?: number
  rowsDeleted?: number
  error?: string
}

export function LibraryItemAdminMenu({ itemId, title }: Props) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Don't allow the confirm dialog to close mid-delete.
  const closeConfirm = useCallback(() => {
    if (!deleting) setConfirmOpen(false)
  }, [deleting])
  useFocusTrap(dialogRef, confirmOpen, closeConfirm)

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  async function doDelete() {
    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/media/${itemId}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as PurgeResult
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      // Refresh the library list and leave the now-deleted detail page.
      router.replace('/library')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-zinc-200 backdrop-blur hover:bg-black/70 hover:text-white transition-colors"
        aria-label="Admin options"
      >
        <Settings className="h-5 w-5" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setError(''); setConfirmOpen(true) }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-800"
          >
            <Trash2 className="h-4 w-4" /> Delete from server
          </button>
        </div>
      )}

      {confirmOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmOpen(false) }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="library-delete-title"
              className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  <h2 id="library-delete-title" className="text-base font-semibold text-zinc-100">Delete from server</h2>
                </div>
                <button onClick={() => !deleting && setConfirmOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="text-sm text-zinc-300">
                Permanently delete <span className="font-semibold text-white">{title}</span>? This removes the
                file(s) from storage, deletes the matching torrent(s) from the download client, and clears it
                from the library, monitoring, and request lists. <span className="text-red-300">This cannot be undone.</span>
              </p>

              {error && <p className="mt-3 rounded-md bg-red-900/40 px-3 py-2 text-xs text-red-300">{error}</p>}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => !deleting && setConfirmOpen(false)}
                  disabled={deleting}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={doDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-60"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {deleting ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
}
