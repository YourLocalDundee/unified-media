// Authenticated proxy to Sonarr's REST API (v3).
// All browser-side Sonarr calls go through here so the API key stays server-side.
// Sonarr uses network_mode: host, so the default URL is the host IP, not a container name.
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'

const SONARR_URL = process.env.SONARR_URL ?? 'http://192.168.0.50:8989'
const SONARR_API_KEY = process.env.SONARR_API_KEY ?? ''

type Params = { params: Promise<{ path: string[] }> }

async function proxy(req: NextRequest, { params }: Params) {
  await requireAuth()
  const { path } = await params
  const endpoint = '/api/v3/' + path.join('/')
  const search = req.nextUrl.search

  const headers: Record<string, string> = { 'X-Api-Key': SONARR_API_KEY }
  const contentType = req.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType

  try {
    // Read the body as a raw buffer to support both JSON and form payloads
    // without needing to know the format in advance.
    const body = req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.arrayBuffer()
      : undefined

    const res = await fetch(`${SONARR_URL}${endpoint}${search}`, {
      method: req.method,
      headers,
      body,
    })

    const ct = res.headers.get('content-type') ?? ''
    const data = ct.includes('application/json') ? await res.json() : await res.text()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const DELETE = proxy
