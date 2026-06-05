/**
 * Auth gate for all /downloads/* routes. requireAuth() is called here at
 * the layout level so that every page under this segment is protected without
 * each page needing its own auth check. The layout itself renders nothing
 * beyond a passthrough fragment — all structure lives in the page components.
 */
import { requireAuth } from '@/lib/dal'

export default async function DownloadsLayout({ children }: { children: React.ReactNode }) {
  await requireAuth()
  return <>{children}</>
}
