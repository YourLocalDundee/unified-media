const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3001',
  'http://localhost:3000',
].filter(Boolean) as string[]

export function verifyOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  // Browsers always send Origin on cross-origin requests; its absence means a same-origin or
  // server-to-server call, both of which are safe to allow.
  if (!origin) return true
  // Exact match only. The previous `origin.startsWith(o)` branch was bypassable with a
  // suffix domain — e.g. `https://unified.minijoe.dev.evil.com` passes startsWith against
  // `https://unified.minijoe.dev` (A1-002). An exact compare against the full-origin
  // allowlist (which already includes the dev ports) closes that hole.
  return ALLOWED_ORIGINS.includes(origin)
}
