// Server-only Prowlarr HTTP client.
// Prowlarr uses X-Api-Key header auth on the /api/v1 base path.
// GET responses bypass the Next.js cache — indexer status must always be live.

const PROWLARR_URL = process.env.PROWLARR_URL ?? 'http://192.168.0.50:9696'
const PROWLARR_API_KEY = process.env.PROWLARR_API_KEY ?? ''

export async function prowlarrFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET'
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  const headers: Record<string, string> = {
    'X-Api-Key': PROWLARR_API_KEY,
    ...(isWrite && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  }

  const response = await fetch(`${PROWLARR_URL}/api/v1${path}`, {
    ...options,
    headers,
    cache: method === 'GET' ? 'no-store' : undefined,
  })

  if (!response.ok) {
    let body = ''
    try { body = await response.text() } catch { }
    throw new Error(`Prowlarr ${method} ${path} → ${response.status}: ${body}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
