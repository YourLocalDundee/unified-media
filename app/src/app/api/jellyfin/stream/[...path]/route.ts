import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'

export const dynamic = 'force-dynamic'

const JELLYFIN_URL = process.env.JELLYFIN_URL ?? ''
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY ?? ''

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getSession()
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { path } = await params
  const pathStr = path.join('/')

  // Build target Jellyfin URL, forwarding all query params except api_key
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${JELLYFIN_URL}/${pathStr}`)

  incomingUrl.searchParams.forEach((value, key) => {
    if (key !== 'api_key') {
      targetUrl.searchParams.set(key, value)
    }
  })
  // Inject API key server-side
  targetUrl.searchParams.set('api_key', JELLYFIN_API_KEY)

  const authHeader = `MediaBrowser Client="unified-frontend", Device="server", DeviceId="unified-frontend-01", Version="0.1.0", Token="${JELLYFIN_API_KEY}"`

  let jellyfinRes: Response
  try {
    jellyfinRes = await fetch(targetUrl.toString(), {
      headers: {
        Authorization: authHeader,
      },
    })
  } catch (err) {
    console.error('[Stream proxy] Fetch failed:', err)
    return new NextResponse('Bad Gateway', { status: 502 })
  }

  if (!jellyfinRes.ok) {
    console.error('[Stream proxy]', jellyfinRes.status, 'for', pathStr)
    return new NextResponse(null, { status: jellyfinRes.status })
  }

  const contentType = jellyfinRes.headers.get('content-type') ?? 'application/octet-stream'
  const isManifest = contentType.includes('mpegurl') || pathStr.endsWith('.m3u8')

  if (isManifest) {
    // Rewrite segment URLs in the manifest to go through our proxy
    const text = await jellyfinRes.text()
    const rewritten = rewriteHlsManifest(text)
    return new NextResponse(rewritten, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store, no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // For video segments (.ts files), stream directly
  return new NextResponse(jellyfinRes.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

function rewriteHlsManifest(manifest: string): string {
  const jellyfinHostname = new URL(JELLYFIN_URL).hostname

  return manifest
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || trimmed === '') return line

      // Handle absolute Jellyfin URLs (http://192.168.0.50:8096/...)
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
          const url = new URL(trimmed)
          if (url.hostname === jellyfinHostname) {
            url.searchParams.delete('api_key')
            return `/api/jellyfin/stream${url.pathname}${url.search}`
          }
        } catch {
          // Not a valid URL, return as-is
        }
        return line
      }

      // Handle root-relative paths (/videos/abc/seg.ts?...)
      if (trimmed.startsWith('/')) {
        const [pathPart, queryPart] = trimmed.split('?')
        const cleanQuery = queryPart
          ? '?' + queryPart.replace(/(?:^|&)api_key=[^&]*/g, '').replace(/^&/, '')
          : ''
        return `/api/jellyfin/stream${pathPart}${cleanQuery}`
      }

      return line
    })
    .join('\n')
}
