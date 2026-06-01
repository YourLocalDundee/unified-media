import { requireAuth } from '@/lib/dal'

export default async function DownloadsLayout({ children }: { children: React.ReactNode }) {
  await requireAuth()
  return <>{children}</>
}
