const SONARR_URL = process.env.SONARR_URL ?? 'http://192.168.0.50:8989'
const SONARR_API_KEY = process.env.SONARR_API_KEY ?? ''

export async function sonarrFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET'
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  const headers: Record<string, string> = {
    'X-Api-Key': SONARR_API_KEY,
    ...(isWrite && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  }

  const response = await fetch(`${SONARR_URL}/api/v3${path}`, {
    ...options,
    headers,
    cache: method === 'GET' ? 'no-store' : undefined,
  })

  if (!response.ok) {
    let body = ''
    try { body = await response.text() } catch { }
    throw new Error(`Sonarr ${method} ${path} → ${response.status}: ${body}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
