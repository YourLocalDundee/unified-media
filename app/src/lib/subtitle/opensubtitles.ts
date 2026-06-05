// OpenSubtitles v3 REST API client.
// Free tier: 5 subtitle downloads per day, resets at midnight UTC.
// API key is passed as the 'Api-Key' header (not Authorization/Bearer).
// Searches are ordered by download_count descending so popular/well-tested subs
// appear first. Only srt and vtt formats are kept — ass/ssa are filtered out
// because the player does not support them without a conversion step.
import type {
  OSDownloadResponse,
  OSSearchResponse,
  OSSubtitle,
  SubtitleSearchParams,
} from './types'

const BASE_URL = 'https://api.opensubtitles.com/api/v1'
const ALLOWED_FORMATS = new Set(['srt', 'vtt'])

function getApiKey(): string | undefined {
  return process.env.OPENSUBTITLES_API_KEY
}

function buildHeaders(): HeadersInit {
  return {
    'Api-Key': getApiKey() ?? '',
    'Content-Type': 'application/json',
    'User-Agent': 'unified-frontend/1.0',
  }
}

async function osFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `[opensubtitles] ${options?.method ?? 'GET'} ${path} failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    )
  }

  return res.json() as Promise<T>
}

async function searchSubtitles(params: SubtitleSearchParams): Promise<OSSubtitle[]> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[opensubtitles] OPENSUBTITLES_API_KEY is not set — skipping search')
    return []
  }

  const qs = new URLSearchParams()

  if (params.imdb_id) {
    // OpenSubtitles expects a plain integer with no "tt" prefix and no leading zeros.
    // scanner.ts strips the "tt" prefix; this strips any remaining leading zeros.
    const numeric = params.imdb_id.replace(/^tt0*/, '').replace(/^0+/, '') || '0'
    qs.set('imdb_id', numeric)
  }

  if (params.tmdb_id != null) {
    qs.set('tmdb_id', String(params.tmdb_id))
  }

  if (params.query) {
    qs.set('query', params.query)
  }

  qs.set('languages', params.languages)
  qs.set('type', params.type)

  if (params.hearing_impaired) {
    qs.set('hearing_impaired', params.hearing_impaired)
  }

  qs.set('order_by', 'download_count')
  qs.set('order_direction', 'desc')

  try {
    const response = await osFetch<OSSearchResponse>(`/subtitles?${qs.toString()}`)

    const filtered = response.data.filter((sub) =>
      ALLOWED_FORMATS.has(sub.attributes.format?.toLowerCase()),
    )

    // Cap at 5 candidates — pickBestSubtitle scores them; returning more is
    // wasted memory and the top 5 by download_count are almost always sufficient.
    return filtered.slice(0, 5)
  } catch (err) {
    console.error('[opensubtitles] searchSubtitles error:', err)
    return []
  }
}

async function getDownloadLink(fileId: number): Promise<OSDownloadResponse> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('[opensubtitles] OPENSUBTITLES_API_KEY is not set — cannot download subtitle')
  }

  const response = await osFetch<OSDownloadResponse>('/download', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId }),
  })

  if (response.remaining === 0) {
    console.warn('[opensubtitles] Daily download limit reached')
  }

  return response
}

// Scoring heuristic: trusted uploader is the dominant signal (+100), HI match
// is secondary (+10), and download_count is a 0–9 tiebreaker so prolific but
// low-quality subs don't beat a trusted uploader with fewer downloads.
function pickBestSubtitle(results: OSSubtitle[], wantHi: boolean): OSSubtitle | null {
  if (results.length === 0) return null

  const scored = results.map((sub) => {
    const attrs = sub.attributes
    let score = 0

    if (attrs.from_trusted) score += 100
    if (attrs.hearing_impaired === wantHi) score += 10

    // Normalize download_count into a 0–9 tiebreaker
    score += Math.min(attrs.download_count / 1_000_000, 9)

    return { sub, score }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored[0].sub
}

export { searchSubtitles, getDownloadLink, pickBestSubtitle }
