'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface AddTorrentModalProps {
  open: boolean
  initialFile?: File | null
  categories: Record<string, { name: string; savePath: string }>
  tags: string[]
  defaultSavePath: string
  onClose: () => void
  onAdded: () => void
}

export default function AddTorrentModal({
  open,
  initialFile,
  categories,
  tags,
  defaultSavePath,
  onClose,
  onAdded,
}: AddTorrentModalProps) {
  const [urlText, setUrlText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [savePath, setSavePath] = useState(defaultSavePath)
  const [category, setCategory] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [startPaused, setStartPaused] = useState(false)
  const [sequential, setSequential] = useState(false)
  const [firstLast, setFirstLast] = useState(false)
  const [skipCheck, setSkipCheck] = useState(false)
  const [autoTMM, setAutoTMM] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (initialFile) setFile(initialFile)
  }, [initialFile])

  useEffect(() => {
    if (open) {
      setSavePath(defaultSavePath)
      setError(null)
    }
  }, [open, defaultSavePath])

  const handleCategoryChange = useCallback((val: string) => {
    setCategory(val)
    const cat = Object.values(categories).find((c) => c.name === val)
    if (cat && cat.savePath && !autoTMM) setSavePath(cat.savePath)
  }, [categories, autoTMM])

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const effectiveCategory = newCategory.trim() || category
    const tagsStr = selectedTags.join(',')

    if (!file && !urlText.trim()) {
      setError('Provide a magnet/URL or a .torrent file.')
      return
    }

    setIsPending(true)
    try {
      let res: Response
      if (file) {
        const fd = new FormData()
        fd.append('torrents', file)
        if (savePath) fd.append('savepath', savePath)
        if (effectiveCategory) fd.append('category', effectiveCategory)
        if (tagsStr) fd.append('tags', tagsStr)
        if (startPaused) fd.append('stopped', 'true')
        if (sequential) fd.append('sequentialDownload', 'true')
        if (firstLast) fd.append('firstLastPiecePrio', 'true')
        if (skipCheck) fd.append('skip_checking', 'true')
        if (autoTMM) fd.append('useAutoTMM', 'true')
        res = await fetch('/api/qbit/torrents/add', { method: 'POST', body: fd })
      } else {
        const body = new URLSearchParams()
        body.set('urls', urlText.trim())
        if (savePath) body.set('savepath', savePath)
        if (effectiveCategory) body.set('category', effectiveCategory)
        if (tagsStr) body.set('tags', tagsStr)
        if (startPaused) body.set('stopped', 'true')
        if (sequential) body.set('sequentialDownload', 'true')
        if (firstLast) body.set('firstLastPiecePrio', 'true')
        if (skipCheck) body.set('skip_checking', 'true')
        if (autoTMM) body.set('useAutoTMM', 'true')
        res = await fetch('/api/qbit/torrents/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Reset
      setUrlText('')
      setFile(null)
      setCategory('')
      setNewCategory('')
      setSelectedTags([])
      setStartPaused(false)
      setSequential(false)
      setFirstLast(false)
      setSkipCheck(false)
      setAutoTMM(false)
      if (fileRef.current) fileRef.current.value = ''
      onAdded()
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setIsPending(false)
    }
  }, [file, urlText, savePath, category, newCategory, selectedTags, startPaused, sequential, firstLast, skipCheck, autoTMM, onAdded, onClose])

  if (!open) return null

  const catNames = Object.values(categories).map((c) => c.name)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Add Torrent
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {/* URL / Magnet */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Magnet link or URL
            </label>
            <textarea
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              placeholder="magnet:?xt=urn:btih:... or https://..."
              rows={3}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {/* File picker */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              .torrent file
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".torrent"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-200 dark:file:bg-gray-700 dark:file:text-gray-300"
            />
            {file && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{file.name}</p>
            )}
          </div>

          {/* Save path */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Save path
            </label>
            <input
              type="text"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              disabled={autoTMM}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          {/* Category */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Category
            </label>
            <div className="flex gap-2">
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">— None —</option>
                {catNames.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="or type new"
                className="w-32 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      selectedTags.includes(tag)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Start paused', value: startPaused, set: setStartPaused },
              { label: 'Sequential DL', value: sequential, set: setSequential },
              { label: 'First/Last piece priority', value: firstLast, set: setFirstLast },
              { label: 'Skip hash check', value: skipCheck, set: setSkipCheck },
              { label: 'Auto TMM', value: autoTMM, set: setAutoTMM },
            ].map(({ label, value, set }) => (
              <label key={label} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {label}
              </label>
            ))}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
