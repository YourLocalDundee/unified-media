interface GeoResult { country: string; city: string }
interface CacheEntry { data: GeoResult; expiresAt: number }
const cache = new Map<string, CacheEntry>()
const UNKNOWN: GeoResult = { country: 'Unknown', city: '' }

export async function getCountryFromIP(ip: string): Promise<GeoResult> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { country: 'Local', city: '' }
  }
  const now = Date.now()
  const cached = cache.get(ip)
  if (cached && cached.expiresAt > now) return cached.data
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,city`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return UNKNOWN
    const json = await res.json() as { country?: string; city?: string }
    const data: GeoResult = { country: json.country ?? 'Unknown', city: json.city ?? '' }
    cache.set(ip, { data, expiresAt: now + 3_600_000 })
    return data
  } catch {
    return UNKNOWN
  }
}
