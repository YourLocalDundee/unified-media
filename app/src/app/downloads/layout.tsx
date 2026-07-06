/**
 * Auth gate for all /downloads/* routes. requireAdmin() is called here at the layout level so the
 * download queue is visible to admins only — non-admins are silently redirected to home. Every page
 * under this segment is protected without each page needing its own check. The layout renders nothing
 * beyond a passthrough fragment — all structure lives in the page components.
 */
import { requireAdmin } from '@/lib/dal'

export default async function DownloadsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <>{children}</>
}
