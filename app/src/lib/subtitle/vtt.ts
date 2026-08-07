// Shared SRT → WebVTT conversion for the native subtitle serving routes.
// A plain <track> element requires WebVTT; the downloader saves OpenSubtitles
// files as .srt, so any route serving a downloaded file converts on the fly.
// The two formats differ in:
//   1. VTT requires a "WEBVTT" header line
//   2. VTT uses '.' as the millisecond separator; SRT uses ','
// Simple SRT content (no SSA/ASS override tags) converts cleanly this way.
export function srtToVtt(srt: string): string {
  const normalized = srt.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const body = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${body}\n`
}

// True when the file content already carries a WebVTT header (no conversion needed).
export function isAlreadyVtt(raw: string): boolean {
  return raw.trimStart().startsWith('WEBVTT')
}
