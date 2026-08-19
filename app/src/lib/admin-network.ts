/**
 * Network restriction for admin access.
 *
 * The app is reachable from the public internet at https://minijoe.dev/unified, and the rebuilt
 * stack has no WAF in front of it (BunkerWeb is gone — see CLAUDE.md §7). Password strength is
 * therefore the only thing standing between the internet and full control of the media stack.
 *
 * Admin access is additionally gated on WHERE the request comes from: the tailnet, the LAN, or
 * the box itself. A stolen admin password is useless from the open internet, because the attacker
 * also has to be on a network they cannot reach.
 *
 * This is deliberately network-based, not device-based: any device on the tailnet passes, so it
 * is a perimeter, not an identity check. Regular (non-admin) accounts are unaffected and work
 * from anywhere.
 *
 * Defaults cover:
 *   100.64.0.0/10   Tailscale/CGNAT — the tailnet
 *   10.0.0.0/8      private LAN
 *   172.16.0.0/12   private, and the Docker bridge networks — a browser on the server
 *                   itself is seen as a bridge gateway address, which is how a local login
 *                   is recorded
 *   192.168.0.0/16  private LAN
 *   127.0.0.0/8     loopback
 *
 * The ranges are the standard private ones rather than this deployment's own subnet: a
 * client can only present a private source address if it is already inside the perimeter,
 * so narrowing them further buys nothing and puts the site's topology in a public repo.
 *
 * Override with ADMIN_ALLOWED_CIDRS (comma-separated). Setting it to `0.0.0.0/0` disables the
 * restriction entirely; do that knowingly, not by accident.
 */

const DEFAULT_CIDRS = [
  '100.64.0.0/10',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
]

function allowedCidrs(): string[] {
  const raw = process.env.ADMIN_ALLOWED_CIDRS
  if (!raw) return DEFAULT_CIDRS
  const parsed = raw.split(',').map(s => s.trim()).filter(Boolean)
  return parsed.length > 0 ? parsed : DEFAULT_CIDRS
}

/** Dotted-quad -> uint32. Returns null for anything that is not a plain IPv4 literal. */
function toUint32(ip: string): number | null {
  // IPv6-mapped IPv4 (::ffff:10.0.0.1) arrives from some proxies; unwrap it.
  const unmapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const parts = unmapped.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    out = (out << 8) | n
  }
  return out >>> 0
}

function inCidr(ip: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/')
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false

  const ipNum = toUint32(ip)
  const netNum = toUint32(network)
  if (ipNum === null || netNum === null) return false

  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (ipNum & mask) === (netNum & mask)
}

/**
 * True when `ip` may hold an admin session. IPv6 loopback is accepted; any other IPv6 address is
 * rejected, because the allowlist is expressed in IPv4 and silently passing what we cannot
 * evaluate would defeat the point.
 */
export function isAdminNetwork(ip: string): boolean {
  const trimmed = ip.trim()
  if (trimmed === '::1') return true
  return allowedCidrs().some(cidr => inCidr(trimmed, cidr))
}
