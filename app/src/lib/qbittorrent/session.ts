// This file runs only on the server (used only in API routes / server components)

const QBIT_URL = process.env.QBIT_URL ?? 'http://qbittorrent:8080'
const QBIT_USERNAME = process.env.QBIT_USERNAME ?? 'admin'
const QBIT_PASSWORD = process.env.QBIT_PASSWORD ?? ''

interface SessionCache {
  sid: string
  expiresAt: number
}

let sessionCache: SessionCache | null = null

async function login(): Promise<string> {
  const body = new URLSearchParams({
    username: QBIT_USERNAME,
    password: QBIT_PASSWORD,
  })

  const res = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) throw new Error(`qBittorrent login failed: ${res.status}`)

  // qBittorrent returns 200 with body "Fails." on wrong credentials
  const text = await res.text()
  if (text.trim() === 'Fails.') {
    throw new Error('qBittorrent login failed: invalid credentials')
  }

  const setCookie = res.headers.get('set-cookie') ?? ''
  // qBittorrent v5 uses QBT_SID_{port}=..., v4 uses SID=...
  const sidMatch = setCookie.match(/((?:QBT_SID_\d+|SID)=[^;]+)/)
  if (!sidMatch) throw new Error('qBittorrent login: no SID in response')

  return sidMatch[1]   // returns full "QBT_SID_8080=VALUE" or "SID=VALUE" string
}

export async function getQbitSession(): Promise<string> {
  const now = Date.now()
  if (sessionCache && sessionCache.expiresAt > now) return sessionCache.sid

  const sid = await login()
  sessionCache = { sid, expiresAt: now + 25 * 60 * 1000 } // 25 minute TTL
  return sid
}

export function clearSession(): void {
  sessionCache = null
}

export async function qbitFetch<T = unknown>(
  path: string,
  options?: { method?: 'GET' | 'POST'; body?: URLSearchParams }
): Promise<T> {
  const sid = await getQbitSession()
  const method = options?.method ?? 'GET'

  const headers: HeadersInit = { Cookie: sid }   // sid is already "NAME=VALUE"
  if (method === 'POST' && options?.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  const res = await fetch(`${QBIT_URL}${path}`, {
    method,
    headers,
    body: options?.body,
    cache: 'no-store',
  })

  if (res.status === 403) {
    // Re-auth once
    clearSession()
    const newSid = await getQbitSession()
    const retryHeaders: HeadersInit = { Cookie: newSid }
    if (method === 'POST' && options?.body) {
      retryHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    const retryRes = await fetch(`${QBIT_URL}${path}`, {
      method,
      headers: retryHeaders,
      body: options?.body,
      cache: 'no-store',
    })
    if (!retryRes.ok) {
      throw new Error(`qBittorrent ${method} ${path}: ${retryRes.status}`)
    }
    const ct = retryRes.headers.get('content-type') ?? ''
    return ct.includes('application/json')
      ? retryRes.json()
      : (retryRes.text() as unknown as T)
  }

  if (!res.ok) throw new Error(`qBittorrent ${method} ${path}: ${res.status}`)

  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json')
    ? res.json()
    : (res.text() as unknown as T)
}
