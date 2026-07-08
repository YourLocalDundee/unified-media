'use client'

// Admin-only "Create torrent" dialog — builds a .torrent from a local file/folder path via
// qBittorrent's async torrent-creation task API (5.0+). See useCreateTorrentTask in
// @/lib/qbittorrent/hooks and the doc comments on CreateTorrentParams / TorrentCreationTask in
// @/lib/qbittorrent/types for the endpoint contract. Styling mirrors AddTorrentForm/
// DeleteConfirmModal on this page.

import { useState, useRef, useCallback } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useCreateTorrentTask } from '@/lib/qbittorrent/hooks'
import { formatBytes } from '@/lib/utils'

// 0 = automatic (qBittorrent picks based on content size). The rest are the powers-of-two
// qBittorrent's own torrent creator dialog offers, 16 KiB through 16 MiB.
const PIECE_SIZE_OPTIONS: { label: string; value: number }[] = [
  { label: 'Auto', value: 0 },
  ...[16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216].map(
    (bytes) => ({ label: formatBytes(bytes), value: bytes })
  ),
]

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'
const labelClass = 'mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300'

interface Props {
  onClose: () => void
}

function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: 'blue' | 'green' | 'red' }) {
  const toneClass = {
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  )
}

export function CreateTorrentDialog({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, onClose)

  const { uiStatus, task, submitError, submit, reset } = useCreateTorrentTask()

  // Form fields — kept in the dialog (not the hook) so "Try again" after a failure
  // re-shows the form with everything the admin already typed still in place.
  const [sourcePath, setSourcePath] = useState('')
  const [trackers, setTrackers] = useState('')
  const [urlSeeds, setUrlSeeds] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [startSeeding, setStartSeeding] = useState(true)
  const [comment, setComment] = useState('')
  const [source, setSource] = useState('')
  const [pieceSize, setPieceSize] = useState(0)
  const [validationError, setValidationError] = useState<string | null>(null)

  // A live task is in flight (or finished/failed) once the hook has a taskId-backed
  // status — that's the signal to show the progress view instead of the form.
  const showProgress = task !== null || uiStatus === 'submitting' || uiStatus === 'polling'

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const path = sourcePath.trim()
      if (!path) {
        setValidationError('Source path is required.')
        return
      }
      setValidationError(null)
      submit({
        sourcePath: path,
        trackers: parseLines(trackers),
        urlSeeds: parseLines(urlSeeds),
        private: isPrivate,
        startSeeding,
        comment: comment.trim() || undefined,
        source: source.trim() || undefined,
        pieceSize: pieceSize || undefined,
      }).catch(() => {
        // Surfaced via submitError/uiStatus below — nothing else to do here.
      })
    },
    [sourcePath, trackers, urlSeeds, isPrivate, startSeeding, comment, source, pieceSize, submit]
  )

  const handleTryAgain = useCallback(() => {
    reset()
  }, [reset])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-torrent-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="create-torrent-title" className="text-base font-semibold text-foreground">
            Create Torrent
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {!showProgress ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="ct-source-path" className={labelClass}>
                  Source file or folder path <span className="text-red-500">*</span>
                </label>
                <input
                  id="ct-source-path"
                  type="text"
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  placeholder="/data/media/Movies/My.Movie.2026"
                  className={inputClass}
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-400">
                  A path qBittorrent itself can read — not a path in this browser.
                </p>
              </div>

              <div>
                <label htmlFor="ct-trackers" className={labelClass}>
                  Tracker URLs (one per line)
                </label>
                <textarea
                  id="ct-trackers"
                  value={trackers}
                  onChange={(e) => setTrackers(e.target.value)}
                  rows={3}
                  placeholder={'udp://tracker.example.org:1337/announce'}
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Private torrent
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={startSeeding}
                    onChange={(e) => setStartSeeding(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Start seeding when done
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ct-piece-size" className={labelClass}>
                    Piece size
                  </label>
                  <select
                    id="ct-piece-size"
                    value={pieceSize}
                    onChange={(e) => setPieceSize(Number(e.target.value))}
                    className={inputClass}
                  >
                    {PIECE_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ct-source" className={labelClass}>
                    Source (optional)
                  </label>
                  <input
                    id="ct-source"
                    type="text"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    placeholder="e.g. tracker tag"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ct-comment" className={labelClass}>
                  Comment (optional)
                </label>
                <input
                  id="ct-comment"
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="ct-url-seeds" className={labelClass}>
                  URL seeds (optional, one per line)
                </label>
                <textarea
                  id="ct-url-seeds"
                  value={urlSeeds}
                  onChange={(e) => setUrlSeeds(e.target.value)}
                  rows={2}
                  placeholder="https://example.org/files/my.movie.2026/"
                  className={`${inputClass} font-mono`}
                />
              </div>

              {(validationError || (uiStatus === 'error' && submitError)) && (
                <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                  {validationError ?? submitError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!sourcePath.trim()}
                  className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Create Torrent
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium text-foreground" title={sourcePath}>
                  {sourcePath}
                </span>
                {uiStatus === 'finished' && <StatusPill tone="green">Finished</StatusPill>}
                {uiStatus === 'failed' && <StatusPill tone="red">Failed</StatusPill>}
                {uiStatus === 'error' && <StatusPill tone="red">Error</StatusPill>}
                {(uiStatus === 'submitting' || uiStatus === 'polling') && (
                  <StatusPill tone="blue">{task?.status ?? 'Queued'}</StatusPill>
                )}
              </div>

              {(uiStatus === 'submitting' || uiStatus === 'polling') && (
                <>
                  <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`h-1.5 rounded-full bg-blue-500 transition-all ${
                        typeof task?.progress !== 'number' ? 'w-1/3 animate-pulse' : ''
                      }`}
                      style={
                        typeof task?.progress === 'number'
                          ? { width: `${Math.min(100, Math.max(0, task.progress * 100))}%` }
                          : undefined
                      }
                    />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {typeof task?.progress === 'number'
                      ? `Hashing… ${(task.progress * 100).toFixed(0)}%`
                      : 'Waiting for qBittorrent to start hashing…'}
                    {' '}You can close this dialog — creation continues in the background.
                  </p>
                </>
              )}

              {uiStatus === 'finished' && task && (
                <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
                  <p>
                    Torrent created successfully
                    {startSeeding ? ' and added to the download queue.' : '.'}
                  </p>
                  <a
                    href={`/api/qbit/torrentcreator/torrentFile?taskID=${encodeURIComponent(task.taskID)}`}
                    download={`${task.taskID}.torrent`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                  >
                    Download .torrent
                  </a>
                </div>
              )}

              {(uiStatus === 'failed' || uiStatus === 'error') && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                >
                  {task?.errorMessage ?? submitError ?? 'Torrent creation failed.'}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                >
                  {uiStatus === 'finished' ? 'Done' : 'Close'}
                </button>
                {(uiStatus === 'failed' || uiStatus === 'error') && (
                  <button
                    onClick={handleTryAgain}
                    className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
