/**
 * Proxy for the Prowlarr API. Injects the API key and internal host so neither
 * is ever exposed to the browser.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'

const PROWLARR_URL = process.env.PROWLARR_URL ?? 'http://192.168.0.50:9696'
const PROWLARR_API_KEY = process.env.PROWLARR_API_KEY ?? ''

type Params = { params: Promise<{ path: string[] }> }

async function proxy(req: NextRequest, { params }: Params) {
  // A-3: the only consumer is the admin media-settings page, and an indexer GET can return
  // indexer credentials, so the whole proxy is admin-gated. State-changing verbs additionally
  // require a same-origin request (CSRF) since requireAdmin alone would accept a cross-site
  // form POST carrying the admin's cookie.
  await requireAdmin()
  if (req.method !== 'GET' && req.method !== 'HEAD' && !verifyOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { path } = await params
  const endpoint = '/api/v1/' + path.join('/')
  const search = req.nextUrl.search

  const headers: Record<string, string> = { 'X-Api-Key': PROWLARR_API_KEY }
  const contentType = req.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType

  try {
    const body = req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.arrayBuffer()
      : undefined

    const res = await fetch(`${PROWLARR_URL}${endpoint}${search}`, {
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
