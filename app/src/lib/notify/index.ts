/**
 * Outbound notifications. Fired when a requested item becomes available in the library
 * (the availability cron's approved -> available transition, and the Seerr webhook's
 * MEDIA_AVAILABLE handler — whichever flips the row first; the status guard on each path
 * dedupes so only one notifies).
 *
 * Channel config lives in app_settings (editable at /admin/automation -> Notifications) and is
 * read fresh on every send, so there is no redeploy. All sends are best-effort: a channel
 * failure is logged and swallowed so it never breaks the automation pipeline.
 *
 * Channels:
 *   - Discord (notify_discord_webhook): rich embed with poster thumbnail
 *   - ntfy    (notify_ntfy_url):        JSON publish (title + tags + message)
 *
 * notify_on_available ('1'/'0', default '1') is the master toggle for the availability event.
 * The admin "send test" path (sendTestNotification) ignores the toggle so config can be verified.
 */

import { getSetting } from '@/lib/settings/index'
import { getDb } from '@/lib/db/index'
import { sendPushToUser } from '@/lib/push'

const TMDB_IMG = 'https://image.tmdb.org/t/p/w200'
const SEND_TIMEOUT_MS = 8000

export interface MediaAvailablePayload {
  title: string
  year?: number | null
  mediaType: 'movie' | 'tv'
  tmdbId: number
  posterPath?: string | null
  /** username / display name of the requester, best-effort */
  requestedBy?: string | null
  /** id of the user who requested this item — the Web Push recipient (best-effort) */
  userId?: string | null
}

export interface ChannelResult {
  channel: 'discord' | 'ntfy'
  ok: boolean
  error?: string
}

interface NotifyChannels {
  discordWebhook: string
  ntfyUrl: string
}

function getNotifyChannels(): NotifyChannels {
  return {
    discordWebhook: getSetting('notify_discord_webhook', '').trim(),
    ntfyUrl: getSetting('notify_ntfy_url', '').trim(),
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.name === 'AbortError' ? 'timed out' : e.message
  return String(e)
}

function titleLine(p: MediaAvailablePayload): string {
  return p.year ? `${p.title} (${p.year})` : p.title
}

function bodyLine(p: MediaAvailablePayload): string {
  return p.requestedBy ? `Requested by ${p.requestedBy} — ready to watch.` : 'Ready to watch.'
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function sendDiscord(webhook: string, p: MediaAvailablePayload): Promise<void> {
  const label = p.mediaType === 'movie' ? 'Movie' : 'TV Show'
  const embed: Record<string, unknown> = {
    title: `🎬 Now available: ${titleLine(p)}`,
    description: bodyLine(p),
    color: 0x22c55e, // green-500
    footer: { text: p.tmdbId > 0 ? `${label} • TMDB ${p.tmdbId}` : label },
  }
  if (p.posterPath) embed.thumbnail = { url: `${TMDB_IMG}${p.posterPath}` }
  const res = await fetchWithTimeout(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/**
 * Parse a user-entered ntfy URL like `https://ntfy.sh/my-topic` into the server base and topic
 * so we can use ntfy's JSON publishing API (POST {topic, title, message, tags} to the base). Using
 * the JSON body rather than the `Title`/`Tags` HTTP headers avoids latin1 header-encoding errors on
 * unicode titles (e.g. "Pokémon").
 */
function parseNtfy(url: string): { base: string; topic: string } | null {
  try {
    const u = new URL(url)
    const topic = u.pathname.replace(/^\/+|\/+$/g, '')
    if (!topic || topic.includes('/')) return null
    return { base: `${u.origin}/`, topic }
  } catch {
    return null
  }
}

async function sendNtfy(target: { base: string; topic: string }, p: MediaAvailablePayload): Promise<void> {
  const res = await fetchWithTimeout(target.base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: target.topic,
      title: `Now available: ${titleLine(p)}`,
      message: bodyLine(p),
      tags: [p.mediaType === 'movie' ? 'movie_camera' : 'tv'],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/**
 * Send a payload to every configured channel. Returns a per-channel result list; an empty list
 * means no channels are configured. Never throws.
 */
async function dispatch(p: MediaAvailablePayload): Promise<ChannelResult[]> {
  const { discordWebhook, ntfyUrl } = getNotifyChannels()
  const results: ChannelResult[] = []
  const tasks: Promise<void>[] = []

  if (discordWebhook) {
    tasks.push(
      sendDiscord(discordWebhook, p).then(
        () => { results.push({ channel: 'discord', ok: true }) },
        (e: unknown) => { results.push({ channel: 'discord', ok: false, error: errMsg(e) }) },
      ),
    )
  }
  if (ntfyUrl) {
    const target = parseNtfy(ntfyUrl)
    if (!target) {
      results.push({ channel: 'ntfy', ok: false, error: 'invalid ntfy URL (expected https://host/topic)' })
    } else {
      tasks.push(
        sendNtfy(target, p).then(
          () => { results.push({ channel: 'ntfy', ok: true }) },
          (e: unknown) => { results.push({ channel: 'ntfy', ok: false, error: errMsg(e) }) },
        ),
      )
    }
  }

  await Promise.allSettled(tasks)
  return results
}

/**
 * Resolve a deep-link path for the now-available item. Prefers the owned library
 * item (which exists by the time availability fires) so the push opens straight to
 * it; falls back to the requests list if it can't be resolved.
 */
function resolveDeepLink(tmdbId: number, mediaType: 'movie' | 'tv'): string {
  try {
    // media_items stores TV as type='series'.
    const type = mediaType === 'movie' ? 'movie' : 'series'
    const row = getDb()
      .prepare('SELECT id FROM media_items WHERE tmdb_id = ? AND type = ?')
      .get(tmdbId, type) as { id: string } | undefined
    if (row) return `/library/${row.id}`
  } catch {
    /* DB read failed — fall through to the generic requests page */
  }
  return '/requests'
}

/**
 * Fire the "media now available" notification across all channels. Respects the
 * notify_on_available master toggle. Best-effort: logs channel failures, never throws.
 */
export async function notifyMediaAvailable(p: MediaAvailablePayload): Promise<void> {
  if (getSetting('notify_on_available', '1') !== '1') return
  const results = await dispatch(p)
  for (const r of results) {
    if (!r.ok) console.error(`[notify] ${r.channel} failed for "${p.title}": ${r.error}`)
  }

  // Web Push — sent alongside the Discord/ntfy channels above, to the user who
  // requested the item. No-op (logs only) when VAPID is unconfigured. Best-effort:
  // never lets a push failure break the notification path.
  if (p.userId) {
    await sendPushToUser(p.userId, {
      title: `Now available: ${titleLine(p)}`,
      body: bodyLine(p),
      url: resolveDeepLink(p.tmdbId, p.mediaType),
    }).catch((e: unknown) => {
      console.error(`[notify] push failed for "${p.title}": ${errMsg(e)}`)
    })
  }
}

/**
 * Admin "send test" — dispatches a sample availability notification to every configured channel,
 * ignoring the master toggle. Returns per-channel results so the UI can show what worked.
 */
export async function sendTestNotification(): Promise<ChannelResult[]> {
  return dispatch({
    title: 'Test Notification',
    year: null,
    mediaType: 'movie',
    tmdbId: 0,
    posterPath: null,
    requestedBy: 'unified-frontend',
  })
}
