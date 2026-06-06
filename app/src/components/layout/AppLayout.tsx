// AppLayout — the primary chrome for all authenticated, non-auth pages.
// Composes Sidebar + Header + MobileNav around the page content.
// The /watch/* bypass renders the player full-screen without any chrome.
'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MobileNav } from './MobileNav'
import { useAuth } from '@/context/AuthContext'

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // Watch pages need full-screen access — skip all layout chrome for them.
  const isWatchPage = pathname?.startsWith('/watch/') || pathname?.startsWith('/play/')
  const { user } = useAuth()

  if (isWatchPage) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header username={user?.username} />
        {/* pb-16 on mobile clears the fixed MobileNav bar; md:pb-6 reverts to standard padding */}
        <main className="flex-1 overflow-y-auto p-6 pb-16 md:pb-6">{children}</main>
      </div>
      <MobileNav />
    </div>
  )
}
