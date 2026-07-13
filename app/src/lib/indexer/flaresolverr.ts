// FlareSolverr v3 wrapper. Sends a request.get command and returns the solved HTML.
// Only called for indexers with requires_flaresolverr = 1.
// FlareSolverr POST body: { cmd, url, maxTimeout }
// Response: { solution: { status, headers, response (HTML), cookies, userAgent } }

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL ?? 'http://flaresolverr:8191'

export interface FlareSolverrResult {
  html: string
  cookies: Array<{ name: string; value: string; domain: string; path: string }>
  userAgent: string
}

// The FlareSolverr container is resource-constrained (512MB/0.5 CPU, effectively one Chrome
// instance) — two concurrent solve() calls were confirmed live to make BOTH fail (each hitting
// its own timeout) rather than just running slower serially. This queue-based lock keeps calls
// to a strict one-at-a-time, regardless of how many adapters call flareSolve() concurrently from
// the search fan-out (createLimit(3) in index.ts) — this is a separate, tighter constraint than
// that general fan-out concurrency.
let flareSolverrQueue: Promise<unknown> = Promise.resolve()

function withFlareSolverrLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = flareSolverrQueue.then(fn, fn)
  flareSolverrQueue = result.then(() => undefined, () => undefined)
  return result
}

export function flareSolve(url: string, timeoutMs = 60_000): Promise<FlareSolverrResult> {
  return withFlareSolverrLock(async () => {
    const res = await fetch(`${FLARESOLVERR_URL}/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: timeoutMs }),
    })
    if (!res.ok) throw new Error(`FlareSolverr returned HTTP ${res.status}`)
    const data = await res.json() as {
      status: string
      solution?: { status: number; response: string; cookies: unknown[]; userAgent: string }
    }
    if (data.status !== 'ok' || !data.solution) throw new Error(`FlareSolverr error: ${data.status}`)
    return {
      html: data.solution.response,
      cookies: data.solution.cookies as FlareSolverrResult['cookies'],
      userAgent: data.solution.userAgent,
    }
  })
}
