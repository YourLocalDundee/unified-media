export const JELLYFIN_URL = process.env.JELLYFIN_URL ?? 'http://192.168.0.50:8096'
export const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY ?? ''

function authHeader(): string {
  return `MediaBrowser Client="unified-frontend", Device="server", DeviceId="unified-frontend-01", Version="0.1.0", Token="${JELLYFIN_API_KEY}"`
}

export class JellyfinError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Jellyfin ${status}: ${message}`)
    this.name = 'JellyfinError'
  }

  get isAuthError(): boolean { return this.status === 401 || this.status === 403 }
  get isNotFound(): boolean { return this.status === 404 }
  get isServerError(): boolean { return this.status >= 500 }
}

export async function jellyfinFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${JELLYFIN_URL}${path}`

  const method = options?.method?.toUpperCase() ?? 'GET'
  const isGet = method === 'GET'

  const headers: HeadersInit = {
    Authorization: authHeader(),
    Accept: 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  }

  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    ;(headers as Record<string, string>)['Content-Type'] = 'application/json'
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    ...(isGet
      ? { next: { revalidate: 60 } as NextFetchRequestConfig }
      : {}),
  }

  const response = await fetch(url, fetchOptions)

  if (!response.ok) {
    let body = ''
    try { body = await response.text() } catch { /* ignore */ }
    const truncated = body ? ` — ${body.slice(0, 200)}` : ''
    throw new JellyfinError(response.status, `${response.statusText}${truncated}`)
  }

  // Some endpoints return 204 No Content
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as unknown as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    // Return raw text wrapped as unknown for non-JSON responses
    const text = await response.text()
    return text as unknown as T
  }

  return response.json() as Promise<T>
}

// Type augmentation for Next.js fetch cache options
type NextFetchRequestConfig = {
  revalidate?: number | false
  tags?: string[]
}
