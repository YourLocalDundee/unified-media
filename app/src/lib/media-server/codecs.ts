/**
 * Codec compatibility helpers shared between the playback-decision layer
 * (lib/media-server/playback.ts) and the transcode layer (the HLS route +
 * lib/media-server/transcode.ts).
 *
 * Two distinct "browser-safe audio" sets exist and must not be conflated:
 *
 *   DIRECT_PLAY_SAFE_AUDIO   — codecs a browser can decode from the ORIGINAL container
 *                              in a <video> element (direct play). Used to decide whether
 *                              to offer naive Direct Play or default to the HLS path.
 *
 *   BROWSER_SAFE_AUDIO       — codecs valid inside HLS MPEG-TS segments (transcode.ts).
 *                              Narrower: only aac + mp3. Drives the remux-vs-transcode tier.
 *
 * Direct play is broader because it is not constrained to MPEG-TS muxing. AC3, EAC3, DTS,
 * TrueHD and DTS-HD are excluded from both: Chrome and Firefox cannot decode them and play
 * the video with silent audio rather than firing an error event — the exact failure this
 * detection exists to prevent.
 */

import type { ProbeStream } from './types'

export const DIRECT_PLAY_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac', 'vorbis'])

/**
 * True when a browser can decode this audio codec directly from the source container.
 * Null codec (no audio stream / probe miss) is treated as direct-playable — there is no
 * audio to fail, so video-only direct play is correct.
 */
export function isAudioDirectPlayable(codec: string | null): boolean {
  return codec == null || DIRECT_PLAY_SAFE_AUDIO.has(codec.toLowerCase())
}

/**
 * Selects the intended audio track: the default-flagged track if present, otherwise the
 * first. This mirrors how a browser picks the track to play on direct play, so the
 * compatibility check and the transcoder both operate on the track the user actually hears.
 *
 * `relativeIndex` is the index among audio streams only (array position), suitable for
 * ffmpeg's `-map 0:a:<n>`. Commentary or secondary-language tracks are never picked unless
 * the container marks them default.
 */
export function selectAudioTrack(
  audioStreams: ProbeStream[],
): { stream: ProbeStream | null; relativeIndex: number } {
  if (audioStreams.length === 0) return { stream: null, relativeIndex: 0 }
  const defIdx = audioStreams.findIndex(s => s.isDefault)
  const relativeIndex = defIdx >= 0 ? defIdx : 0
  return { stream: audioStreams[relativeIndex], relativeIndex }
}

// ---------------------------------------------------------------------------
// Subtitle codec classification
// ---------------------------------------------------------------------------

// Image-based (bitmap) subtitle codecs cannot be converted to WebVTT — they are
// pictures, not text. Rendering them requires burn-in (re-encoding the video with
// the subtitle overlaid), which is out of scope for the extract-to-WebVTT path.
const IMAGE_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle', 'pgssub', 'pgs',
  'dvd_subtitle', 'dvdsub',
  'dvb_subtitle', 'dvbsub',
  'dvb_teletext',
  'xsub',
])

/** True when the subtitle codec is bitmap-based and therefore not extractable to WebVTT. */
export function isImageSubtitleCodec(codec: string | null): boolean {
  return codec != null && IMAGE_SUBTITLE_CODECS.has(codec.toLowerCase())
}

// ---------------------------------------------------------------------------
// Language matching (ISO 639-1 / 639-2 normalisation)
// ---------------------------------------------------------------------------

// ffprobe reports 3-letter codes (eng, jpn, fre) while the user preference is a
// 2-letter code (en, ja, fr). Normalise both to 2-letter for comparison. Covers the
// bibliographic (B) and terminological (T) variants for the languages that differ
// (e.g. fre/fra, ger/deu, chi/zho, dut/nld).
const ISO_639_TO_1: Record<string, string> = {
  eng: 'en', en: 'en',
  jpn: 'ja', jpn_jp: 'ja', ja: 'ja',
  fre: 'fr', fra: 'fr', fr: 'fr',
  spa: 'es', es: 'es',
  ger: 'de', deu: 'de', de: 'de',
  chi: 'zh', zho: 'zh', zh: 'zh',
  por: 'pt', pt: 'pt',
  ita: 'it', it: 'it',
  rus: 'ru', ru: 'ru',
  kor: 'ko', ko: 'ko',
  ara: 'ar', ar: 'ar',
  hin: 'hi', hi: 'hi',
  dut: 'nl', nld: 'nl', nl: 'nl',
}

/** Normalises a language tag to its ISO 639-1 (2-letter) form where known. */
export function normalizeLang(lang: string | null | undefined): string {
  if (!lang) return ''
  const k = lang.toLowerCase().trim()
  return ISO_639_TO_1[k] ?? k.slice(0, 2)
}

/** True when a track's language tag matches the preferred language. */
export function languageMatches(streamLang: string | null | undefined, pref: string | null | undefined): boolean {
  if (!pref) return false
  return normalizeLang(streamLang) === normalizeLang(pref)
}

// ---------------------------------------------------------------------------
// Preference-driven track selection (shared by the player's default logic)
// ---------------------------------------------------------------------------

export interface AudioTrackInfo { language: string; relIndex: number }
export interface SubTrackInfo { language: string; title: string; forced: boolean; extractable: boolean }

/**
 * Picks the audio relative index to default to: the track matching the preferred
 * language if one exists, otherwise `fallbackRel` (the server's default-or-first track).
 */
export function selectPreferredAudioRel(
  audioStreams: AudioTrackInfo[],
  prefLang: string,
  fallbackRel: number,
): number {
  if (prefLang) {
    const match = audioStreams.find(a => languageMatches(a.language, prefLang))
    if (match) return match.relIndex
  }
  return fallbackRel
}

/**
 * Picks the positional index (in the subtitle list) to default to for the preferred
 * language, preferring a full track over signs-and-songs / forced tracks. Returns -1
 * when no preference is set or no extractable match exists (subtitles stay off).
 */
export function selectPreferredSubtitleIndex(
  subStreams: SubTrackInfo[],
  prefLang: string,
): number {
  if (!prefLang) return -1
  const matches = subStreams
    .map((s, i) => ({ s, i }))
    .filter(x => x.s.extractable && languageMatches(x.s.language, prefLang))
  if (matches.length === 0) return -1
  const full = matches.find(x => !x.s.forced && !/sign|song|forced/i.test(x.s.title || ''))
  return (full ?? matches[0]).i
}
