/**
 * Validates a post-login redirect target to prevent open-redirect attacks.
 *
 * A `?from=` value is attacker-controllable, so only a same-origin absolute PATH is ever
 * returned. Rejected: anything not starting with `/`, protocol-relative `//evil.com`, any
 * value containing a colon (which covers `javascript:`, `https://`, and the
 * `/\thttps://evil.com` style tricks in one rule), and the auth pages themselves, which
 * would bounce the user straight back into the login flow.
 *
 * The colon rule is deliberately blunt: it also rejects an otherwise-legal path whose query
 * string contains a colon. Redirect targets here are plain in-app paths, so that trade is
 * worth the smaller rule surface — no ordering or position logic to get subtly wrong.
 *
 * Pure and dependency-free, so it is safe to import from client components.
 */
export function getSafeRedirectUrl(
  from: string | null | undefined,
  fallback = '/'
): string {
  if (!from) return fallback
  if (!from.startsWith('/') || from.startsWith('//')) return fallback
  if (from.includes(':')) return fallback
  if (from.startsWith('/login') || from.startsWith('/register')) return fallback
  return from
}
