import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getUserInfo } from '@/lib/subtitle/opensubtitles'

export const dynamic = 'force-dynamic'

// GET /api/subtitle/account — the authoritative OpenSubtitles quota for the configured
// login (logs in, then GET /infos/user). Use this to confirm `allowed_downloads: 1000`
// + `vip: true` before relying on downloads, and to tell a login/auth failure apart from
// a subscription problem. Costs no download quota.
export async function GET() {
  await requireAdmin()

  if (!process.env.OPENSUBTITLES_API_KEY) {
    return NextResponse.json({ error: 'OPENSUBTITLES_API_KEY is not set.' }, { status: 503 })
  }
  if (!process.env.OPENSUBTITLES_USERNAME || !process.env.OPENSUBTITLES_PASSWORD) {
    return NextResponse.json(
      { error: 'OPENSUBTITLES_USERNAME / OPENSUBTITLES_PASSWORD are not set — login is required for the VIP quota.' },
      { status: 503 }
    )
  }

  try {
    const info = await getUserInfo()
    if (!info) {
      return NextResponse.json({ error: 'OpenSubtitles login failed — check credentials.' }, { status: 502 })
    }
    return NextResponse.json(info)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
