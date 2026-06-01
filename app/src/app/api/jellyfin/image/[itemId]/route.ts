import { NextRequest } from 'next/server'
import { JELLYFIN_URL, JELLYFIN_API_KEY } from '@/lib/jellyfin/client'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'Primary'
  const index = searchParams.get('index')
  const width = searchParams.get('width') ?? '400'

  if (type !== 'Primary') {
    console.log(`[jellyfin-image] ${itemId} using fallback type=${type}${index !== null ? ` index=${index}` : ''}`)
  }

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
