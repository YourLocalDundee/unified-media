const BAZARR_URL = process.env.BAZARR_URL ?? 'http://192.168.0.50:6767'
const BAZARR_API_KEY = process.env.BAZARR_API_KEY ?? ''

export async function bazarrFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = options.method?.toUpperCase() ?? 'GET'
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  const headers: Record<string, string> = {
    'X-API-KEY': BAZARR_API_KEY,
    ...(isWrite && options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  }

  const response = await fetch(`${BAZARR_URL}/api${path}`, {
    ...options,
    headers,
    cache: method === 'GET' ? 'no-store' : undefined,
  })

  if (!response.ok) {
    let body = ''
    try { body = await response.text() } catch { }
    throw new Error(`Bazarr ${method} ${path} → ${response.status}: ${body}`)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
