/**
 * User-Agent → short human device label, e.g. "Chrome on Windows", "Safari on iPhone".
 *
 * Stored on sessions.device_name at createSession() so the session list in
 * /settings/profile can tell two sessions apart. This replaced a five-line client-side
 * regex in ProfileClient.tsx that returned "Mobile" for every phone and "Chrome" for
 * every desktop Chrome, which made "revoke this one" guesswork whenever a user had two
 * sessions in the same browser family.
 *
 * Deliberately not a UA-parsing dependency. This label is cosmetic — it helps a human
 * recognise their own device in a list of at most a handful. It is never used for a
 * security decision, so an unrecognised UA degrading to "Unknown device" is fine and a
 * ~50kB parser library is not worth it.
 *
 * Order matters throughout: Edge and Opera UAs both contain "Chrome", Chrome's contains
 * "Safari", and every mobile UA contains its browser token too, so the most specific
 * test has to run first.
 */

function browserFrom(ua: string): string {
  // Edge and Opera must precede Chrome; Chrome must precede Safari.
  if (/\bEdgA?\//.test(ua)) return 'Edge'
  if (/\bOPR\/|\bOpera\//.test(ua)) return 'Opera'
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox'
  if (/\bCriOS\//.test(ua)) return 'Chrome'
  if (/\bChrome\//.test(ua)) return 'Chrome'
  if (/\bSafari\//.test(ua)) return 'Safari'
  return ''
}

function platformFrom(ua: string): string {
  // iPadOS 13+ reports a desktop Mac UA, so iPad is only detectable by its explicit token.
  if (/\biPhone\b/.test(ua)) return 'iPhone'
  if (/\biPad\b/.test(ua)) return 'iPad'
  if (/\bAndroid\b/.test(ua)) return 'Android'
  if (/\bWindows NT\b/.test(ua)) return 'Windows'
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'Mac'
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS'
  if (/\bLinux\b/.test(ua)) return 'Linux'
  return ''
}

export function deviceNameFromUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'

  // The Capacitor wrapper is an Android WebView ("; wv") pointed at the live site. Label it
  // as the app rather than "Chrome on Android", because from the user's side it is the app.
  if (/\bwv\b/.test(userAgent) && /\bAndroid\b/.test(userAgent)) return 'Android app'

  const browser = browserFrom(userAgent)
  const platform = platformFrom(userAgent)

  if (browser && platform) return `${browser} on ${platform}`
  if (browser) return browser
  if (platform) return platform
  return 'Unknown device'
}
