// Web app manifest — Next.js metadata route convention. Next auto-serves this
// at /manifest.webmanifest and injects the <link rel="manifest"> tag into
// every page's <head>; nothing else needs to reference this file.
//
// Colors are pulled from the app's dark theme tokens (src/app/globals.css):
// --background: 222 47% 11% -> #0f1729, --primary: 217 91% 60% -> #3c83f6.
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Unified Media',
    short_name: 'Unified',
    description: 'Browse, request, and watch your media library from one app.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0f1729',
    theme_color: '#3c83f6',
    icons: [
      // SVG source icon. Modern Chromium/Firefox accept SVG manifest icons directly.
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      // Rasterized fallbacks for installers/launchers that require a fixed-size
      // raster icon (e.g. some Android launchers, Windows tiles).
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
