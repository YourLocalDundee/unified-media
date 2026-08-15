import { describe, it, expect } from 'vitest'
import { deviceNameFromUserAgent } from './device-name'

// Real UA strings. The ordering traps this function exists to avoid are all here:
// Edge and Opera carry "Chrome", Chrome carries "Safari", iOS browsers carry "Safari"
// regardless of which browser they actually are, and every mobile UA carries its
// platform token alongside the browser token.
describe('deviceNameFromUserAgent', () => {
  const cases: Array<[string, string, string]> = [
    [
      'Chrome on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    [
      'Edge is not Chrome',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      'Edge on Windows',
    ],
    [
      'Opera is not Chrome',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
      'Opera on Windows',
    ],
    [
      'Safari on Mac is not Chrome',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Safari on Mac',
    ],
    [
      'Firefox on Linux',
      'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
      'Firefox on Linux',
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Chrome on iOS reports CriOS, still Chrome',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome on iPhone',
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Samsung Internet is not Chrome',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    [
      'the Capacitor wrapper is labelled as the app, not the WebView',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36',
      'Android app',
    ],
  ]

  it.each(cases)('%s', (_label, ua, expected) => {
    expect(deviceNameFromUserAgent(ua)).toBe(expected)
  })

  it('degrades rather than throwing on missing or unrecognised input', () => {
    expect(deviceNameFromUserAgent(null)).toBe('Unknown device')
    expect(deviceNameFromUserAgent(undefined)).toBe('Unknown device')
    expect(deviceNameFromUserAgent('')).toBe('Unknown device')
    expect(deviceNameFromUserAgent('curl/8.5.0')).toBe('Unknown device')
  })

  it('falls back to the half it can identify', () => {
    // Platform with no recognisable browser token.
    expect(deviceNameFromUserAgent('SomeBot/1.0 (Windows NT 10.0)')).toBe('Windows')
  })
})
