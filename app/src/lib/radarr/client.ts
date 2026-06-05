// Server-only Radarr HTTP client.
// Radarr uses X-Api-Key header auth on the /api/v3 base path.
// GET responses bypass the Next.js cache so movie availability
// and queue status are always fresh.

const RADARR_URL = process.env.RADARR_URL ?? 'http://192.168.0.50:7878'
const RADARR_API_KEY = process.env.RADARR_API_KEY ?? ''

export async function radarrFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET'
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  const headers: Record<string, string> = {
    'X-Api-Key': RADARR_API_KEY,
    ...(isWrite && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  }

  const response = await fetch(`${RADARR_URL}/api/v3${path}`, {
    ...options,
    headers,
    cache: method === 'GET' ? 'no-store' : undefined,
  })

  if (!response.ok) {
    let body = ''
    try { body = await response.text() } catch { }
    throw new Error(`Radarr ${method} ${path} → ${response.status}: ${body}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
