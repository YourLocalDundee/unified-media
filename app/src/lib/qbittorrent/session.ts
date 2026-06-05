// Server-only qBittorrent session manager.
// qBittorrent uses cookie-based auth (SID), not API keys. The SID must be
// obtained by POSTing credentials and then sent as a Cookie header on every
// subsequent request. This module caches the SID in a module-level variable so
// the full login round-trip only happens once per 25-minute TTL window.
// All functions here MUST stay server-side — never import from a client component.

// This file runs only on the server (used only in API routes / server components)

const UMT_URL = process.env.UMT_URL ?? 'http://qbittorrent:8080'
const UMT_USERNAME = process.env.UMT_USERNAME ?? 'admin'
const UMT_PASSWORD = process.env.UMT_PASSWORD ?? ''

interface SessionCache {
  sid: string
  expiresAt: number
}

// Module-level singleton — intentional. One SID is shared across all requests
// in the same Node.js worker process, which is fine because qBit sessions are
// not user-scoped (there is only one qBittorrent account in use here).
let sessionCache: SessionCache | null = null

async function login(): Promise<string> {
  const body = new URLSearchParams({
    username: UMT_USERNAME,
    password: UMT_PASSWORD,
  })

  const res = await fetch(`${UMT_URL}/api/v2/auth/login`, {
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

  const res = await fetch(`${UMT_URL}${path}`, {
    method,
    headers,
    body: options?.body,
    cache: 'no-store',
  })

  if (res.status === 403) {
    // qBittorrent evicts sessions on restart or after the server-side idle timeout.
    // Clear and re-login exactly once; if the retry still fails, let it throw.
    clearSession()
    const newSid = await getQbitSession()
    const retryHeaders: HeadersInit = { Cookie: newSid }
    if (method === 'POST' && options?.body) {
      retryHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    const retryRes = await fetch(`${UMT_URL}${path}`, {
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

  // qBittorrent action endpoints (pause, resume, delete, add) return plain text
  // "Ok." on success, not JSON. Check Content-Type before attempting to parse.
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json')
    ? res.json()
    : (res.text() as unknown as T)
}
