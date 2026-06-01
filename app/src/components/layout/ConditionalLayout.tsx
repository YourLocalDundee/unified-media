'use client'

import { usePathname } from 'next/navigation'
import { AppLayout } from './AppLayout'

const AUTH_PATHS = ['/login', '/register', '/forgot', '/change-password', '/invite']

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthPage = AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (isAuthPage) return <>{children}</>
  return <AppLayout>{children}</AppLayout>
}
