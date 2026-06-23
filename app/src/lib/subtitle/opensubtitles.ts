// OpenSubtitles v3 REST API client.
//
// Auth model (important):
//   - Every request sends the static `Api-Key` header (consumer key).
//   - Downloads also send `Authorization: Bearer <token>` from POST /login. WITHOUT a
//     login the API draws on a low anonymous bucket (~100/day); WITH a login it draws
//     on the user's real quota (VIP = 1000/day). So login is mandatory to get the VIP
//     ceiling. The JWT (~24h TTL) and the login `base_url` are cached in module scope
//     and refreshed on expiry or on a 401.
//
// Daily download quota resets at midnight UTC; only getDownloadLink() spends it,
// searches are free. The authoritative live quota is GET /infos/user (getUserInfo()).
import type {
  OSDownloadResponse,
  OSLoginResponse,
  OSSearchResponse,
  OSSubtitle,
  OSUserInfo,
  SubtitleSearchParams,
} from './types'

const DEFAULT_HOST = 'api.opensubtitles.com'
const USER_AGENT = 'unified-frontend/1.0'

// VIP daily download ceiling — the documented default for a VIP consumer. The live
// value is read from /infos/user at runtime; this is only used for low-quota warnings.
export const VIP_DAILY_DOWNLOAD_CEILING = 1000

// Re-login this far before the ~24h JWT expiry to avoid mid-request token death.
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000

function getApiKey(): string | undefined {
  return process.env.OPENSUBTITLES_API_KEY || undefined
}

function getCredentials(): { username: string; password: string } | null {
  const username = process.env.OPENSUBTITLES_USERNAME
  const password = process.env.OPENSUBTITLES_PASSWORD
  if (!username || !password) return null
  return { username, password }
}

function baseHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Api-Key': getApiKey() ?? '',
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
  }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

// ---------------------------------------------------------------------------
// Login / auth-token cache
// ---------------------------------------------------------------------------

interface AuthState {
  token: string
  apiBase: string // full base incl. /api/v1, e.g. https://vip-api.opensubtitles.com/api/v1
  fetchedAt: number
}

let authState: AuthState | null = null
// In-flight login promise so concurrent callers share one /login round-trip.
let loginInFlight: Promise<AuthState | null> | null = null

function apiBaseFromHost(host?: string): string {
  const clean = (host || DEFAULT_HOST).replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `https://${clean}/api/v1`
}

async function doLogin(): Promise<AuthState | null> {
  const apiKey = getApiKey()
  const creds = getCredentials()
  if (!apiKey || !creds) return null

  const res = await fetch(`https://${DEFAULT_HOST}/api/v1/login`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ username: creds.username, password: creds.password }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[opensubtitles] login failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
  }
  const data = (await res.json()) as OSLoginResponse
  authState = {
    token: data.token,
    apiBase: apiBaseFromHost(data.base_url),
    fetchedAt: Date.now(),
  }
  return authState
}

// Returns a valid auth state, logging in (or reusing the cached token) as needed.
// Returns null when credentials are not configured — callers then fall back to the
// anonymous Api-Key bucket.
async function ensureAuth(forceRefresh = false): Promise<AuthState | null> {
  if (!getCredentials()) return null
  if (!forceRefresh && authState && Date.now() - authState.fetchedAt < TOKEN_TTL_MS) {
    return authState
  }
  if (forceRefresh) authState = null
  if (!loginInFlight) {
    loginInFlight = doLogin().finally(() => {
      loginInFlight = null
    })
  }
  return loginInFlight
}

// ---------------------------------------------------------------------------
// Search (no quota cost, no login required)
// ---------------------------------------------------------------------------

async function searchSubtitles(params: SubtitleSearchParams): Promise<OSSubtitle[]> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[opensubtitles] OPENSUBTITLES_API_KEY is not set — skipping search')
    return []
  }

  const qs = new URLSearchParams()

  // OpenSubtitles expects a plain integer with no "tt" prefix and no leading zeros.
  const stripImdb = (id: string) => id.replace(/^tt0*/, '').replace(/^0+/, '') || '0'
  if (params.imdb_id) qs.set('imdb_id', stripImdb(params.imdb_id))
  // Episode matching: series imdb + season/episode beats a per-episode imdb_id.
  if (params.parent_imdb_id) qs.set('parent_imdb_id', stripImdb(params.parent_imdb_id))
  if (params.season_number != null) qs.set('season_number', String(params.season_number))
  if (params.episode_number != null) qs.set('episode_number', String(params.episode_number))
  if (params.tmdb_id != null) qs.set('tmdb_id', String(params.tmdb_id))
  if (params.query) qs.set('query', params.query)

  qs.set('languages', params.languages)
  qs.set('type', params.type)
  if (params.hearing_impaired) qs.set('hearing_impaired', params.hearing_impaired)
  qs.set('order_by', 'download_count')
  qs.set('order_direction', 'desc')

  try {
    const res = await fetch(`https://${DEFAULT_HOST}/api/v1/subtitles?${qs.toString()}`, {
      headers: baseHeaders(),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`search failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
    }
    const response = (await res.json()) as OSSearchResponse

    // NOTE: do NOT filter on `attributes.format` — the v3 search response leaves it
    // undefined for essentially every result, so filtering here silently returned zero
    // candidates (the bug that made the whole feature appear dead). The actual format is
    // normalised at download time via `sub_format: 'srt'` in getDownloadLink(), and the
    // written file is content-validated, so keeping all results here is safe.
    const usable = response.data.filter((sub) => sub.attributes.files?.[0]?.file_id != null)

    // Cap the candidate set: the interactive player picker shows these and the auto
    // picker scores them; the top 10 by download_count are more than enough.
    return usable.slice(0, 10)
  } catch (err) {
    console.error('[opensubtitles] searchSubtitles error:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Download (spends quota; uses the logged-in token to reach the VIP bucket)
// ---------------------------------------------------------------------------

async function getDownloadLink(fileId: number): Promise<OSDownloadResponse> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('[opensubtitles] OPENSUBTITLES_API_KEY is not set — cannot download subtitle')
  }

  const auth = await ensureAuth()
  if (!auth) {
    console.warn(
      '[opensubtitles] No OPENSUBTITLES_USERNAME/PASSWORD configured — downloading from the ' +
        'anonymous ~100/day bucket instead of the VIP 1000/day quota.',
    )
  }

  const send = (state: AuthState | null) =>
    fetch(`${state?.apiBase ?? apiBaseFromHost()}/download`, {
      method: 'POST',
      headers: baseHeaders(state?.token),
      // sub_format normalises every source format to SRT (srtToVtt handles it downstream).
      body: JSON.stringify({ file_id: fileId, sub_format: 'srt' }),
    })

  let res = await send(auth)
  // A 401 on an authenticated request means the cached token expired — re-login once.
  if (res.status === 401 && auth) {
    const fresh = await ensureAuth(true)
    if (fresh) res = await send(fresh)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `[opensubtitles] POST /download failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    )
  }

  const response = (await res.json()) as OSDownloadResponse
  if (response.remaining <= 0) {
    console.warn('[opensubtitles] Daily download limit reached')
  } else if (response.remaining < 20) {
    console.warn(`[opensubtitles] Low daily quota: ${response.remaining} downloads remaining`)
  }
  return response
}

// ---------------------------------------------------------------------------
// User info (authoritative live quota; no download cost)
// ---------------------------------------------------------------------------

async function getUserInfo(): Promise<OSUserInfo | null> {
  const apiKey = getApiKey()
  if (!apiKey) return null
  const auth = await ensureAuth()
  if (!auth) return null

  const send = (state: AuthState) =>
    fetch(`${state.apiBase}/infos/user`, { headers: baseHeaders(state.token) })

  let res = await send(auth)
  if (res.status === 401) {
    const fresh = await ensureAuth(true)
    if (!fresh) return null
    res = await send(fresh)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[opensubtitles] GET /infos/user failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`)
  }
  const data = (await res.json()) as { data: OSUserInfo }
  return data.data
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
    score += Math.min(attrs.download_count / 1_000_000, 9)
    return { sub, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0].sub
}

export { searchSubtitles, getDownloadLink, getUserInfo, pickBestSubtitle }
