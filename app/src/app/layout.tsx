// Root Next.js layout — wraps every page in the app.
// Sets up fonts, global CSS, client providers, and the conditional shell layout.

import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import ConditionalLayout from '@/components/layout/ConditionalLayout'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'minime',
  description: 'Unified media dashboard',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Start with class="dark" as the SSR default so there's no flash before the
    // inline script runs. data-theme drives the actual CSS variable set.
    <html lang="en" className="dark" data-theme="dark">
      <head>
        {/* Inline theme-restore script runs before first paint to prevent FOUC.
            It reads localStorage('unified-theme') and patches data-theme on <html>
            before React hydrates. Using dangerouslySetInnerHTML avoids CSP issues
            with an external script tag and is intentionally tiny/inlinable. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('unified-theme');if(t)document.documentElement.setAttribute('data-theme',t);else if(window.matchMedia('(prefers-color-scheme: light)').matches)document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${inter.variable} min-h-screen bg-background font-sans antialiased`}>
        <Providers>
          {/* ConditionalLayout suppresses the app shell on auth pages (/login, /register, etc.) */}
          <ConditionalLayout>{children}</ConditionalLayout>
        </Providers>
      </body>
    </html>
  )
}
