/**
 * Party Play — client-side REST wrappers for the lifecycle routes.
 *
 * These run in the browser. Every call sends the unified-session cookie
 * (credentials:'same-origin') and throws on a non-2xx response so callers can
 * surface the error. The shapes mirror the route handlers in app/api/party/*.
 */

export interface CreatePartyResult {
  partyId: string
  joinCode: string
  joinUrl: string
}

export interface JoinPartyResult {
  partyId: string
  mediaId: string
  joinCode: string
}

export interface PartyInfo {
  id: string
  joinCode: string
  mediaId: string
  hostUserId: string
  status: 'active' | 'ended'
  members: { userId: string; displayName: string; isHost: boolean }[]
}

async function parseError(res: Response): Promise<never> {
  let message = `Request failed (${res.status})`
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) message = body.error
  } catch {
    /* non-JSON body */
  }
  throw new Error(message)
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return parseError(res)
  return (await res.json()) as T
}

export async function createParty(mediaId: string): Promise<CreatePartyResult> {
  return postJson<CreatePartyResult>('/api/party', { mediaId })
}

export async function joinParty(arg: { joinCode?: string; partyId?: string }): Promise<JoinPartyResult> {
  return postJson<JoinPartyResult>('/api/party/join', arg)
}

export async function getPartyInfo(partyId: string): Promise<PartyInfo> {
  const res = await fetch(`/api/party/${partyId}`, {
    method: 'GET',
    credentials: 'same-origin',
  })
  if (!res.ok) return parseError(res)
  return (await res.json()) as PartyInfo
}

export async function leaveParty(partyId: string): Promise<void> {
  const res = await fetch(`/api/party/${partyId}/leave`, {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) return parseError(res)
}

export async function endParty(partyId: string): Promise<void> {
  const res = await fetch(`/api/party/${partyId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) return parseError(res)
}
