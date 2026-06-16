// Image proxy for Jellyfin artwork (poster, backdrop, thumb).
// Proxying is required because: (a) the Jellyfin API key cannot be embedded in
// browser-side <img src> tags, and (b) Jellyfin runs on the host IP
// (192.168.0.50:8096) which is not reachable from the client's browser on
// external networks. The response is cached for 1 hour at the CDN/Next.js layer.
import { NextRequest } from 'next/server'
import { getSession } from '@/lib/dal'
import { JELLYFIN_URL, JELLYFIN_API_KEY } from '@/lib/jellyfin/client'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  // S1: credentialed Jellyfin proxy — require a session so it can't be used as an open artwork
  // relay to probe arbitrary item ids with the server key.
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { itemId } = await params
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'Primary'
  const index = searchParams.get('index')
  const width = searchParams.get('width') ?? '400'

  // Log non-Primary requests to help diagnose missing artwork (e.g. backdrop index out of range).
  if (type !== 'Primary') {
    console.log(`[jellyfin-image] ${itemId} using fallback type=${type}${index !== null ? ` index=${index}` : ''}`)
  }

  // Backdrop images are indexed (e.g. /Images/Backdrop/0, /Backdrop/1).
  // All other types (Primary, Thumb, Logo) use the type name as the path segment.
  let imagePath: string
  if (type === 'Backdrop' && index !== null) {
    imagePath = `${JELLYFIN_URL}/Items/${itemId}/Images/Backdrop/${index}`
  } else {
    imagePath = `${JELLYFIN_URL}/Items/${itemId}/Images/${type}`
  }

  const jellyfinUrl = new URL(imagePath)
  jellyfinUrl.searchParams.set('fillWidth', width)
  jellyfinUrl.searchParams.set('quality', '80')
  if (JELLYFIN_API_KEY) {
    jellyfinUrl.searchParams.set('ApiKey', JELLYFIN_API_KEY)
  }

  const authHeader = `MediaBrowser Client="unified-frontend", Device="server", DeviceId="unified-frontend-01", Version="0.1.0", Token="${JELLYFIN_API_KEY}"`

  try {
    const res = await fetch(jellyfinUrl.toString(), {
      headers: {
        Authorization: authHeader,
      },
      // Cache at the fetch level for 1 hour; artwork rarely changes between deploys.
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      return new Response(null, { status: res.status })
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=3600, immutable',
      },
    })
  } catch {
    return new Response(null, { status: 502 })
  }
}
