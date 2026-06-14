/**
 * Trusted client-IP extraction (A1-005).
 *
 * The previous per-route helpers took the LEFTMOST X-Forwarded-For value, which is
 * exactly the part a client can forge: an attacker rotating `X-Forwarded-For: <random>`
 * got a fresh rate-limit bucket on every request, nullifying every auth limit.
 *
 * Production path is BunkerWeb -> Caddy -> app. Both proxies APPEND the IP of their
 * immediate peer to X-Forwarded-For (BunkerWeb via nginx `$proxy_add_x_forwarded_for`,
 * Caddy by default), so the chain the app receives looks like:
 *
 *     <client-forged...>, <real-client>, <bunkerweb>
 *
 * The real client IP is therefore the entry the OUTERMOST trusted proxy added — the
 * Nth-from-the-right entry, where N is the number of trusted proxies. Anything to the
 * LEFT of that position is client-supplied and untrusted; an attacker can prepend any
 * number of forged entries and they can never reach position `len - N`.
 *
 * N defaults to 2 (BunkerWeb + Caddy). Override with TRUSTED_PROXY_COUNT if the edge
 * topology changes. Setting it too LOW re-opens the spoof (you start trusting a
 * client-supplied entry); too HIGH collapses every client onto one inter-proxy IP and
 * shares a single bucket. Verify it matches the number of appending hops in front of
 * the app before changing it.
 */

const DEFAULT_TRUSTED_PROXY_COUNT = 2

function trustedProxyCount(): number {
  const n = parseInt(process.env.TRUSTED_PROXY_COUNT ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_TRUSTED_PROXY_COUNT
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) {
      // Clamp to 0 so a shorter-than-expected chain (dev with no proxies, or a
      // misconfigured edge) falls back to the leftmost present entry instead of
      // indexing out of bounds.
      const idx = Math.max(0, parts.length - trustedProxyCount())
      return parts[idx]
    }
  }
  // No XFF at all (e.g. a direct dev connection). x-real-ip is a single value some
  // proxies set; use it, then fall back to loopback.
  return req.headers.get('x-real-ip')?.trim() || '127.0.0.1'
}
