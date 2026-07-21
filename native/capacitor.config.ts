import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.minijoe.unified',
  appName: 'Unified Media',
  webDir: 'www',
  server: {
    // Load the live site directly instead of a bundled static build. The
    // WebView's cookie jar and Origin header are then indistinguishable from
    // mobile Chrome/Safari hitting unified.minijoe.dev, so the existing
    // cookie-session auth (src/lib/dal.ts) and verifyOrigin() CSRF check
    // (src/lib/csrf.ts, allowlists NEXT_PUBLIC_APP_URL) work unmodified.
    url: 'https://unified.minijoe.dev',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
