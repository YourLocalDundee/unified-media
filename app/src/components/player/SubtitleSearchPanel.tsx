// On-demand subtitle search overlay for the player. Searches OpenSubtitles for the
// currently-open item (by its server-resolved IMDB id), lists candidates, and grabs
// the one the viewer picks. On a successful grab the parent injects a live <track>
// and selects it — no page reload. All network calls hit the same /api/media/subtitles
// base the player already uses for serving tracks.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { X, Search, Check, Loader2, Download } from 'lucide-react'

interface Candidate {
  fileId: number
  language: string
  release: string
  fileName: string
  hi: boolean
  fromTrusted: boolean
  downloadCount: number
  format: string
  uploader: string
}

interface GrabResult {
  wantId: number
  label: string
  language: string
  forced: boolean
}

interface Props {
  itemId: string
  subtitleApiBase: string
  defaultLanguage: string
  onClose: () => void
  onAdded: (track: GrabResult) => void
}

// Common subtitle languages; the viewer's preferred default is merged in so it is
// always selectable even if not in this base set.
const BASE_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
]

export default function SubtitleSearchPanel({
  itemId,
  subtitleApiBase,
  defaultLanguage,
  onClose,
  onAdded,
}: Props) {
  const initialLang = (defaultLanguage || 'en').toLowerCase()
  const [language, setLanguage] = useState(initialLang)
  const [hi, setHi] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [searched, setSearched] = useState(false)
  // fileId currently downloading, and the set already added this session.
  const [grabbing, setGrabbing] = useState<number | null>(null)
  const [added, setAdded] = useState<Set<number>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)

  const languages = BASE_LANGUAGES.some((l) => l.code === initialLang)
    ? BASE_LANGUAGES
    : [{ code: initialLang, name: initialLang.toUpperCase() }, ...BASE_LANGUAGES]

  const runSearch = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const qs = new URLSearchParams({ mediaId: itemId, language, hi: hi ? '1' : '0' })
      const res = await fetch(`${subtitleApiBase}/search?${qs.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Search failed (${res.status})`)
      }
      const data = (await res.json()) as { candidates: Candidate[]; hasImdb: boolean }
      setCandidates(data.candidates)
      if (data.candidates.length === 0) {
        setNotice(
          data.hasImdb
            ? 'No subtitles found for this language.'
            : 'No IMDB id for this title — searched by name, no matches.'
        )
      } else {
        setNotice(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setCandidates([])
    } finally {
      setLoading(false)
    }
  }, [itemId, subtitleApiBase, language, hi])

  // Auto-search on open for the default language. This is a deliberate
  // fetch-on-mount (synchronize with the external OpenSubtitles API), so the
  // set-state-in-effect / exhaustive-deps rules don't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function grab(c: Candidate) {
    setGrabbing(c.fileId)
    setError(null)
    try {
      const res = await fetch(`${subtitleApiBase}/grab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: itemId,
          fileId: c.fileId,
          language: c.language || language,
          hi: c.hi,
          forced: false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Download failed (${res.status})`)
      }
      setAdded((prev) => new Set(prev).add(c.fileId))
      if (typeof data.remaining === 'number' && data.remaining >= 0) {
        setNotice(`Added. ${data.remaining} OpenSubtitles download(s) left today.`)
      }
      onAdded({
        wantId: data.wantId,
        label: data.label,
        language: data.language,
        forced: data.forced,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setGrabbing(null)
    }
  }

  const selectClass =
    'rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100'

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Search subtitles</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
            aria-label="Close subtitle search"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search controls */}
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            Language
            <select
              className={selectClass}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
            <input
              type="checkbox"
              checked={hi}
              onChange={(e) => setHi(e.target.checked)}
              className="accent-primary"
            />
            Hearing impaired
          </label>
          <button
            onClick={runSearch}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>

        {/* Results */}
        <div className="min-h-[8rem] flex-1 overflow-y-auto px-2 py-2">
          {error && (
            <p className="px-2 py-3 text-sm text-red-400">{error}</p>
          )}
          {!error && loading && candidates.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          )}
          {!error && !loading && searched && candidates.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-zinc-500">
              {notice ?? 'No results.'}
            </p>
          )}
          {candidates.map((c) => {
            const isAdded = added.has(c.fileId)
            const isGrabbing = grabbing === c.fileId
            return (
              <div
                key={c.fileId}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-zinc-800/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-100" title={c.release}>
                    {c.release}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                    <span className="uppercase">{c.language}</span>
                    {c.hi && <span className="text-amber-400">HI</span>}
                    {c.fromTrusted && <span className="text-emerald-400">Trusted</span>}
                    <span>{c.downloadCount.toLocaleString()} dl</span>
                    {c.uploader && <span className="truncate">· {c.uploader}</span>}
                  </p>
                </div>
                <button
                  onClick={() => grab(c)}
                  disabled={isAdded || isGrabbing || grabbing !== null}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isAdded
                      ? 'bg-emerald-600/20 text-emerald-400'
                      : 'bg-zinc-700 text-white hover:bg-zinc-600 disabled:opacity-50'
                  }`}
                >
                  {isAdded ? (
                    <><Check className="h-3.5 w-3.5" /> Added</>
                  ) : isGrabbing ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding</>
                  ) : (
                    <><Download className="h-3.5 w-3.5" /> Add</>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer notice (quota / status) */}
        {notice && candidates.length > 0 && (
          <p className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">{notice}</p>
        )}
      </div>
    </div>
  )
}
