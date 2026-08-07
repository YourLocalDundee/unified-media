// Bookmark management panel inside MediaToolsPanel's Info tab.
// Bookmarks are stored in localStorage under a per-item key (storageKey prop)
// so different media items have independent bookmark lists. Labels are editable
// inline by clicking on the text.
'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Bookmark } from './types'

interface MediaBookmarksProps {
  videoRef: React.RefObject<HTMLVideoElement>
  storageKey: string
}

function formatTime(s: number): string {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0')
}

export default function MediaBookmarks({ videoRef, storageKey }: MediaBookmarksProps) {
  // Initialise from localStorage immediately in the state initialiser to avoid
  // a flash of empty state on mount before a useEffect would run.
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Bookmark[]
    } catch {
      return []
    }
  })
  const [currentTime, setCurrentTime] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [videoRef])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(bookmarks))
    } catch {
    }
  }, [bookmarks, storageKey])

  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingId])

  const handleAdd = () => {
    // Read currentTime directly from the DOM element for the most up-to-date value;
    // the state variable lags by up to 250ms (timeupdate fire interval).
    const time = videoRef.current?.currentTime ?? currentTime
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      label: formatTime(time),
      time,
    }
    // Keep the list sorted chronologically regardless of insertion order.
    setBookmarks((prev) => [...prev, bookmark].sort((a, b) => a.time - b.time))
  }

  const handleSeek = (time: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = time
  }

  const handleDelete = (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }

  const handleStartEdit = (bookmark: Bookmark) => {
    setEditingId(bookmark.id)
    setEditingLabel(bookmark.label)
  }

  const handleSaveEdit = () => {
    if (editingId === null) return
    setBookmarks((prev) =>
      prev.map((b) => (b.id === editingId ? { ...b, label: editingLabel } : b))
    )
    setEditingId(null)
    setEditingLabel('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSaveEdit()
    if (e.key === 'Escape') {
      setEditingId(null)
      setEditingLabel('')
    }
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">Bookmarks</p>
      <button
        onClick={handleAdd}
        className="bg-zinc-700 hover:bg-zinc-600 text-sm rounded px-3 py-1.5 text-white mb-3"
      >
        Add Bookmark
      </button>
      {bookmarks.length === 0 ? (
        <p className="text-zinc-500 text-sm">No bookmarks yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {bookmarks.map((bookmark) => (
            <li
              key={bookmark.id}
              className="flex items-center gap-2 bg-zinc-800 rounded px-2 py-1.5"
            >
              <span className="text-zinc-400 text-xs font-mono w-10 shrink-0">
                {formatTime(bookmark.time)}
              </span>
              {editingId === bookmark.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onBlur={handleSaveEdit}
                  onKeyDown={handleEditKeyDown}
                  className="flex-1 bg-zinc-700 text-white text-sm rounded px-2 py-0.5 outline-none focus:ring-1 ring-white"
                />
              ) : (
                <span
                  onClick={() => handleStartEdit(bookmark)}
                  className="flex-1 text-white text-sm cursor-text truncate"
                >
                  {bookmark.label}
                </span>
              )}
              <button
                onClick={() => handleSeek(bookmark.time)}
                className="bg-zinc-700 hover:bg-zinc-600 text-xs text-white rounded px-2 py-0.5 shrink-0"
              >
                Go
              </button>
              <button
                onClick={() => handleDelete(bookmark.id)}
                className="text-zinc-500 hover:text-red-400 shrink-0"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
