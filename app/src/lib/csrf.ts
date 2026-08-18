// This app is reachable at more than one origin: the canonical HTTPS name Caddy serves, and the
// direct host:port for LAN access when DNS is the problem. NEXT_PUBLIC_APP_URL can only hold one
// of them, and it also feeds password-reset and party links, so it must be the canonical HTTPS
// one. ADDITIONAL_ALLOWED_ORIGINS (comma-separated) carries the rest.
//
// localhost:3000 and localhost:3001 used to be hardcoded here for dev convenience. They were
// removed when the app became publicly reachable: a page served by any dev server on the
// victim's own machine could send one of those as a genuine Origin and pass the CSRF check
// against production. Add them back through ADDITIONAL_ALLOWED_ORIGINS in a dev .env if you
// ever need them — never in the deployed one.
//
// Getting this wrong fails closed and looks like a login bug: an origin that is not listed is
// rejected with 403 before authentication runs at all. That happened for real — the deployment
// moved to https://<app-host> while NEXT_PUBLIC_APP_URL still pointed at the host:port,
// so every mutating request through the real URL was Forbidden.
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  ...(process.env.ADDITIONAL_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
].filter(Boolean) as string[]

export function verifyOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  // Browsers always send Origin on cross-origin requests; its absence means a same-origin or
  // server-to-server call, both of which are safe to allow.
  if (!origin) return true
  // Exact match only. The previous `origin.startsWith(o)` branch was bypassable with a
  // suffix domain — e.g. `https://<app-host>.evil.com` passes startsWith against
  // `https://<app-host>` (A1-002). An exact compare against the full-origin
  // allowlist (which already includes the dev ports) closes that hole.
  return ALLOWED_ORIGINS.includes(origin)
}
