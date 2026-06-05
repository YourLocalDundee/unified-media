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
  return ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))
}
