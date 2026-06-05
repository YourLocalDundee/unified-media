/**
 * Proxy for the Bazarr API. Injects the API key and internal host so neither
 * is ever exposed to the browser.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'

const BAZARR_URL = process.env.BAZARR_URL ?? 'http://192.168.0.50:6767'
const BAZARR_API_KEY = process.env.BAZARR_API_KEY ?? ''

type Params = { params: Promise<{ path: string[] }> }

async function proxy(req: NextRequest, { params }: Params) {
  await requireAuth()
  const { path } = await params
  const endpoint = '/api/' + path.join('/')
  const search = req.nextUrl.search

  const headers: Record<string, string> = { 'X-API-KEY': BAZARR_API_KEY }
  const contentType = req.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType

  try {
    const body = req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.arrayBuffer()
      : undefined

    const res = await fetch(`${BAZARR_URL}${endpoint}${search}`, {
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
