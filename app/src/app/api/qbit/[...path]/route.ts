// Transparent proxy to qBittorrent. Kept for backward compatibility with the
// client-side polling hook (useMainData and action hooks in
// src/lib/qbittorrent/hooks.ts) which call /api/qbit/... from the browser.
// Do not import from the download-client registry here — this route manages
// its own SID session via @/lib/qbittorrent/session.
import { NextRequest, NextResponse } from 'next/server'
import { qbitFetch, getQbitSession, clearSession } from '@/lib/qbittorrent/session'

const QBIT_URL = process.env.QBIT_URL ?? 'http://qbittorrent:8080'

type Params = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { path } = await params
  const endpoint = '/api/v2/' + path.join('/')
  // Preserve all query params (e.g. ?rid=0, ?hash=..., ?filter=...)
  const search = req.nextUrl.search
  try {
    const data = await qbitFetch(`${endpoint}${search}`)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
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
      const qbtRes = await fetch(`${QBIT_URL}${endpoint}${search}`, {
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
        const retryRes = await fetch(`${QBIT_URL}${endpoint}${search}`, {
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
