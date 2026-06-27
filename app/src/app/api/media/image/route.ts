import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'

// Restrict to TMDB's actual supported sizes to prevent open SSRF via arbitrary size strings.
const VALID_SIZES = new Set(['w92', 'w154', 'w185', 'w300', 'w342', 'w500', 'w780', 'original'])
const DEFAULT_SIZE = 'w300'

// TMDB poster/backdrop/logo paths are a single `/<hash>.<ext>` segment. Requiring exactly that
// shape structurally rejects `..`, extra path segments, `@`, whitespace, and any trailing `?`/`#`
// that could otherwise steer the upstream request (A-4). The single dot (before the extension)
// means `..` can never appear.
const IMAGE_PATH_RE = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|svg|avif)$/i

export async function GET(req: NextRequest) {
  await requireAuth()

  const { searchParams } = req.nextUrl
  const path = searchParams.get('path') ?? ''
  const sizeParam = searchParams.get('size') ?? DEFAULT_SIZE

  if (!IMAGE_PATH_RE.test(path)) {
    return NextResponse.json({ error: 'Missing or invalid path parameter' }, { status: 400 })
  }

  const size = VALID_SIZES.has(sizeParam) ? sizeParam : DEFAULT_SIZE
  const url = `https://image.tmdb.org/t/p/${size}${path}`

  let upstream: Response
  try {
    upstream = await fetch(url, { next: { revalidate: 86400 } })
  } catch {
    return NextResponse.json({ error: 'Failed to reach upstream image server' }, { status: 502 })
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: 'Upstream image request failed' }, { status: 502 })
  }

  const contentType = upstream.headers.get('Content-Type') ?? 'image/jpeg'
  const body = await upstream.arrayBuffer()

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  })
}
