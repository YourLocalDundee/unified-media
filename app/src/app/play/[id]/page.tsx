/**
 * /play/[id] — native media server player (backed by getNativePlaybackData).
 * Distinct from /watch/[id] only in its route segment; both use the same VideoPlayer
 * component and playback data source. /play is linked from the library detail page;
 * /watch is linked from the native episode carousel.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import VideoPlayer from '@/components/media/VideoPlayer'
import { getNativePlaybackData } from '@/lib/media-server/playback'
import { requireAuth } from '@/lib/dal'

interface Props {
  params: Promise<{ id: string }>
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

export default async function PlayPage({ params }: Props) {
  const session = await requireAuth()
  const { id } = await params

  let data
  try {
    data = await getNativePlaybackData(id, session.userId)
  } catch {
    notFound()
  }

  return (
    <div className="fixed inset-0 bg-black">
      <VideoPlayer {...data} />
    </div>
  )
}
