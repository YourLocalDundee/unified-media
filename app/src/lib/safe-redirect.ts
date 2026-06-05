export function getSafeRedirectUrl(
  from: string | null | undefined,
  fallback = '/'
): string {
  if (!from) return fallback
  if (!from.startsWith('/')) return fallback
  if (from.startsWith('//')) return fallback
  // Blocks paths like /javascript:alert(1) where a colon appears before the first slash.
  const beforeSlash = from.indexOf(':', 1)
  if (beforeSlash !== -1 && beforeSlash < from.indexOf('/', 1)) return fallback
  if (from.startsWith('/login') || from.startsWith('/register')) return fallback
  return from
}
