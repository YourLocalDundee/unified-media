// Root Next.js layout — wraps every page in the app.
// Sets up fonts, global CSS, client providers, and the conditional shell layout.

import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import ConditionalLayout from '@/components/layout/ConditionalLayout'
import ServiceWorkerRegistration from '@/components/pwa/ServiceWorkerRegistration'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
})

// PWA manifest is auto-linked by Next from src/app/manifest.ts — no explicit
// `manifest:` field needed here.
export const metadata: Metadata = {
  title: 'minime',
  description: 'Unified media dashboard',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Unified',
    statusBarStyle: 'black-translucent',
  },
}

// Matches the --background token per theme in globals.css (dark: 222 47% 11%
// -> #0f1729, light: 0 0% 100% -> #ffffff). The app defaults to dark (see the
// `dark` className below), so the light entry only wins for a user whose
// OS/browser prefers light and who hasn't set `unified-theme` in localStorage.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f1729' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
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
        {/* Registers public/sw.js. Renders nothing; doesn't need auth context. */}
        <ServiceWorkerRegistration />
        <Providers>
          {/* ConditionalLayout suppresses the app shell on auth pages (/login, /register, etc.) */}
          <ConditionalLayout>{children}</ConditionalLayout>
        </Providers>
      </body>
    </html>
  )
}
