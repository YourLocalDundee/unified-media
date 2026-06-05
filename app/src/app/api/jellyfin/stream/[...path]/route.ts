// HLS stream proxy for Jellyfin media. Serves both the .m3u8 manifest and the
// individual .ts segments that hls.js requests. The proxy is necessary because:
//  1. Jellyfin runs on host IP (192.168.0.50:8096), unreachable from the browser.
//  2. The API key cannot be passed as a response header for video resources —
//     browsers don't forward custom headers on <video> requests or hls.js fetches.
// For manifests, segment URLs are rewritten to go through this same proxy route so
// the browser never needs to contact Jellyfin directly.
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

  // Strip any client-supplied api_key and inject the server-side one, preventing
  // clients from probing the API with arbitrary keys.
  const incomingUrl = new URL(request.url)
  const targetUrl = new URL(`${JELLYFIN_URL}/${pathStr}`)

  incomingUrl.searchParams.forEach((value, key) => {
    if (key !== 'api_key') {
      targetUrl.searchParams.set(key, value)
    }
  })
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
  // Check both Content-Type and path extension because Jellyfin may serve .m3u8
  // files with a generic octet-stream type in some configurations.
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

// Rewrites all segment/chunk URLs inside an HLS manifest so they are fetched via
// this proxy rather than hitting Jellyfin directly from the client.
// Three URL forms are handled: absolute Jellyfin URLs, root-relative paths, and
// (implicitly) relative paths which are left unchanged since the browser resolves
// them against the manifest URL — which already points to the proxy.
function rewriteHlsManifest(manifest: string): string {
  const jellyfinHostname = new URL(JELLYFIN_URL).hostname

  return manifest
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || trimmed === '') return line

      // Absolute Jellyfin URL: strip api_key and prefix with our proxy path.
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

      // Root-relative path: strip api_key from query string and prefix proxy path.
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
