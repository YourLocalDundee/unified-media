'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MobileNav } from './MobileNav'
import { useAuth } from '@/context/AuthContext'

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isWatchPage = pathname?.startsWith('/watch/')
  const { user } = useAuth()

  if (isWatchPage) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header username={user?.username} />
        <main className="flex-1 overflow-y-auto p-6 pb-16 md:pb-6">{children}</main>
      </div>
      <MobileNav />
    </div>
  )
}
