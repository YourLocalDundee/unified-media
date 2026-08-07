/**
 * /play/[id] — native media server player (backed by getNativePlaybackData).
 * Distinct from /watch/[id] only in its route segment; both use the same VideoPlayer
 * component and playback data source. /play is linked from the library detail page;
 * /watch is linked from the native episode carousel.
 */
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import VideoPlayer from '@/components/media/VideoPlayer'
import { getNativePlaybackData } from '@/lib/media-server/playback'
import { getItemById } from '@/lib/media-server/library'
import { requireAuth } from '@/lib/dal'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ party?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  try {
    const data = await getNativePlaybackData(id, '')
    const title = data.seriesTitle
      ? `${data.seriesTitle}${data.seasonEpisode ? ` · ${data.seasonEpisode}` : ''} · ${data.itemTitle}`
      : data.itemTitle
    return { title: `${title} — minime` }
  } catch {
    return { title: 'Watch — minime' }
  }
}

export default async function PlayPage({ params, searchParams }: Props) {
  const session = await requireAuth()
  const { id } = await params
  const sp = await searchParams

  let data
  try {
    data = await getNativePlaybackData(id, session.userId)
  } catch {
    const item = getItemById(id)
    if (!item) notFound()
    // Series containers have no file_path — redirect to the detail page where episodes are listed.
    if (item.type === 'series') redirect(`/browse/${id}`)
    notFound()
  }

  return (
    <div className="fixed inset-0 bg-black">
      <VideoPlayer {...data} initialJoinCode={sp.party} selfUserId={session.userId} />
    </div>
  )
}
