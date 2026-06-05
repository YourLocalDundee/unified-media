// Client-only provider wrapper placed just inside <body> in the root layout.
// Initializes React Query and the auth context that all client components depend on.
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState } from 'react'
import { AuthProvider } from '@/context/AuthContext'

export function Providers({ children }: { children: React.ReactNode }) {
  // useState with a factory function ensures the QueryClient is created once per
  // component mount rather than on every render, which is required for correct
  // React Query behavior in React 18+ strict mode.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30s stale time avoids re-fetching data that was just loaded on navigation.
            staleTime: 30 * 1000,
            // 5min garbage collect — keeps inactive queries in cache for quick back navigation.
            gcTime: 5 * 60 * 1000,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {/* AuthProvider must be inside QueryClientProvider so it can use React Query internally. */}
      <AuthProvider>
        {children}
        {/* DevTools only ship in dev builds (tree-shaken in production by the package). */}
        <ReactQueryDevtools initialIsOpen={false} />
      </AuthProvider>
    </QueryClientProvider>
  )
}
