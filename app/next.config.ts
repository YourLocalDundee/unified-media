import type { NextConfig } from 'next'

// wss:// form of the canonical app URL, for the CSP connect-src below. Falls back to the dev
// socket port when the env is unset so `next dev` keeps working.
const wsOrigin = (() => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return 'ws://localhost:3002'
  try {
    const u = new URL(appUrl)
    return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`
  } catch {
    return 'ws://localhost:3002'
  }
})()

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
      {
        protocol: 'https',
        hostname: 'www.themoviedb.org',
        pathname: '/t/p/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://image.tmdb.org blob:",
              "media-src 'self' blob:",
              // The party-play WebSocket. Derived from NEXT_PUBLIC_APP_URL rather than hardcoded:
              // a stale literal here does not fail at build or in dev, it fails only in the
              // browser at runtime as a blocked connection, which is invisible server-side.
              `connect-src 'self' http://ip-api.com ${wsOrigin} ws://localhost:3002`,
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
            ].join('; '),
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
}

export default nextConfig
