// Transparent proxy to qBittorrent's Web API (/api/v2/...).
// Kept for backward compatibility with client-side hooks (useMainData and action
// hooks in src/lib/qbittorrent/hooks.ts) which call /api/qbit/... from the browser.
// Auth is cookie-based (SID), held server-side by @/lib/qbittorrent/session — the
// browser never sees qBittorrent credentials. Do not import from the download-client
// registry here; this route manages its own session directly.
//
// Three fixed gaps vs. a naïve proxy:
//  1. Multipart bodies (torrent file uploads) are forwarded verbatim including the boundary.
//  2. Query params are preserved on POST requests.
//  3. 403 responses trigger one re-auth-and-retry before returning the error.
//
// One more special case lives in GET: /torrentcreator/torrentFile (the finished-.torrent
// download for the async create-torrent task API) returns a binary application/x-bittorrent
// body. qbitFetch() always calls res.text() on non-JSON responses, which decodes the bytes as
// UTF-8 and corrupts binary content — so that one path bypasses qbitFetch and streams the
// response through as an ArrayBuffer instead, same 403-retry-once behavior as everything else.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { qbitFetch, getQbitSession, clearSession } from '@/lib/qbittorrent/session'

const UMT_URL = process.env.UMT_URL ?? 'http://qbittorrent:8080'

type Params = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, { params }: Params) {
  // Admin-only: the download queue and qBittorrent prefs are visible to admins only. This proxy
  // attaches qBittorrent's server-side SID, so any authed caller could otherwise read the full
  // queue/save-paths/prefs with our credentials. Reads are gated to admin to match the write path
  // and keep the Downloads page + Torrent settings admin-only end to end.
  await requireAdmin()
  const { path } = await params
  const endpoint = '/api/v2/' + path.join('/')
  // Preserve all query params (e.g. ?rid=0, ?hash=..., ?filter=...)
  const search = req.nextUrl.search

  if (endpoint === '/api/v2/torrentcreator/torrentFile') {
    try {
      const sid = await getQbitSession()
      let qbtRes = await fetch(`${UMT_URL}${endpoint}${search}`, { headers: { Cookie: sid } })
      if (qbtRes.status === 403) {
        clearSession()
        const newSid = await getQbitSession()
        qbtRes = await fetch(`${UMT_URL}${endpoint}${search}`, { headers: { Cookie: newSid } })
      }
      if (!qbtRes.ok) {
        return NextResponse.json({ error: `qBittorrent GET ${endpoint}: ${qbtRes.status}` }, { status: qbtRes.status })
      }
      const buf = await qbtRes.arrayBuffer()
      return new NextResponse(buf, {
        headers: {
          'Content-Type': qbtRes.headers.get('content-type') ?? 'application/x-bittorrent',
          'Content-Disposition': qbtRes.headers.get('content-disposition') ?? 'attachment',
        },
      })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  try {
    const data = await qbitFetch(`${endpoint}${search}`)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  // A-3: qBittorrent POST is the write surface (add/delete torrents, setPreferences, speed limits)
  // over shared download infrastructure, so it requires admin — not just any authenticated user.
  // GET (viewing the queue) stays open to authed users so the downloads page still renders for them.
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { path } = await params
  const endpoint = '/api/v2/' + path.join('/')
  const search = req.nextUrl.search
  const contentType = req.headers.get('content-type') ?? ''

  try {
    let responseData: unknown

    if (contentType.includes('multipart/form-data')) {
      // Pass the raw body through to qBittorrent.
      // Must forward the Content-Type header including the boundary parameter.
      const sid = await getQbitSession()

      const bodyBuffer = await req.arrayBuffer()
      const qbtRes = await fetch(`${UMT_URL}${endpoint}${search}`, {
        method: 'POST',
        headers: {
          Cookie: sid,
          'Content-Type': contentType, // forward boundary
        },
        body: bodyBuffer,
      })

      if (qbtRes.status === 403) {
        // Re-auth once
        clearSession()
        const newSid = await getQbitSession()
        const retryRes = await fetch(`${UMT_URL}${endpoint}${search}`, {
          method: 'POST',
          headers: {
            Cookie: newSid,
            'Content-Type': contentType,
          },
          body: bodyBuffer,
        })
        const ct = retryRes.headers.get('content-type') ?? ''
        responseData = ct.includes('application/json')
          ? await retryRes.json()
          : await retryRes.text()
      } else {
        const ct = qbtRes.headers.get('content-type') ?? ''
        responseData = ct.includes('application/json')
          ? await qbtRes.json()
          : await qbtRes.text()
      }
    } else {
      // application/x-www-form-urlencoded — existing path
      const text = await req.text()
      const body = new URLSearchParams(text)
      responseData = await qbitFetch(endpoint + search, { method: 'POST', body })
    }

    return NextResponse.json(responseData)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
