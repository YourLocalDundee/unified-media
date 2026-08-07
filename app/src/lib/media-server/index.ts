/**
 * Public surface of the native media server library.
 * Consumers should import from this barrel file rather than individual modules so
 * internal module boundaries can be refactored without touching call sites.
 * Only explicitly listed exports are surfaced; internal helpers stay private.
 */

export * from './types'
export * from './library'
export * from './playback'
export { scanFile, removeFromDb, initWatcher, scanAll } from './scanner'
export { enrichItem, enrichAll } from './enricher'
export { probeFile } from './probe'
export { parseFilename } from './filename-parser'
export { chooseTier, ensureHls, waitForSegment, getSegmentPath, extractSubtitleToVtt } from './transcode'
export type { TranscodeTier } from './transcode'
export { searchMovie, getMovie, searchTV, getTV, tmdbImageUrl } from './tmdb'
