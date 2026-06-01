const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3001',
  'http://localhost:3000',
].filter(Boolean) as string[]

export function verifyOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true // server-to-server, no origin header
  return ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))
}
