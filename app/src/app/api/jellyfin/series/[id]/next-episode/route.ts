import { NextRequest, NextResponse } from 'next/server'
import { jellyfinFetch } from '@/lib/jellyfin/client'

export const dynamic = 'force-dynamic'

interface NextUpItem {
  Id: string
  Name: string
  IndexNumber?: number
  ParentIndexNumber?: number
}

interface NextUpResult {
  Items: NextUpItem[]
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userId = process.env.JELLYFIN_USER_ID ?? ''
  try {
    const result = await jellyfinFetch<NextUpResult>(
      `/Shows/NextUp?SeriesId=${id}&UserId=${userId}&Limit=1&Fields=UserData`
    )
    const ep = result.Items?.[0]
    if (!ep) return NextResponse.json(null)
    return NextResponse.json({
      id: ep.Id,
      title: ep.Name,
      seasonEpisode:
        ep.ParentIndexNumber != null && ep.IndexNumber != null
          ? `S${ep.ParentIndexNumber} E${ep.IndexNumber}`
          : undefined,
    })
  } catch {
    return NextResponse.json(null)
  }
}
