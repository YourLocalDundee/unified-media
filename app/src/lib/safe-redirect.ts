export function getSafeRedirectUrl(
  from: string | null | undefined,
  fallback = '/'
): string {
  if (!from) return fallback
  if (!from.startsWith('/')) return fallback
  if (from.startsWith('//')) return fallback
  // Check for scheme attack (e.g. /javascript:alert)
  const beforeSlash = from.indexOf(':', 1)
  if (beforeSlash !== -1 && beforeSlash < from.indexOf('/', 1)) return fallback
  if (from.startsWith('/login') || from.startsWith('/register')) return fallback
  return from
}
