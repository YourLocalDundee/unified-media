/**
 * Fake-upscale detection — a soft, informational signal, never a hard gate.
 *
 * Some torrent releases claim 2160p (4K) resolution but are actually just an upscaled
 * re-label of a lower-resolution source with no real added detail — a known scene/P2P
 * problem, especially on older TV/movies where no legitimate remaster exists. A genuine
 * 2160p file, even an efficiently-encoded anime release, still has to represent 4x the
 * pixel data of 1080p and will clear a conservative size floor; a relabeled-without-
 * re-encode fake will not.
 *
 * Deliberately scoped to ONLY the 2160p claim. 720p/1080p floors vary far too much by
 * genre (anime vs. live-action legitimate bitrate norms differ by 3-5x — a 300MB/24min
 * anime episode is completely normal, but would look "suspicious" under a live-action-
 * calibrated floor) to set a safe universal threshold without false-positiving on
 * legitimate small anime encodes, which is exactly the content this must not break.
 *
 * The floor itself is deliberately permissive (calibrated to the shortest common runtime,
 * ~24min anime episodes, and movies get a flat ~100min-equivalent floor since TorznabResult
 * never carries actual runtime) so it only catches releases dramatically undersized for
 * ANY genuine 4K source — not borderline-efficient encodes. This trades missing
 * sophisticated fakes (an upscale that's then genuinely re-encoded at real 4K bitrate) for
 * near-zero false positives on real content.
 */

const GB = 1024 ** 3

const MOVIE_2160P_FLOOR_BYTES = 2.5 * GB
const EPISODE_2160P_FLOOR_BYTES = 0.6 * GB

// Mirrors grabber.ts's PACK_RANGE_RE shape — a real multi-episode pack scales the
// per-episode floor by however many episodes the title's numeric range covers.
const PACK_RANGE_RE = /(?<![0-9])(\d{2,4})\s*[-–~]\s*(\d{2,4})(?![0-9])/

function estimatePackEpisodeCount(title: string): number {
  const m = title.match(PACK_RANGE_RE)
  if (!m) return 1
  const a = parseInt(m[1], 10)
  const b = parseInt(m[2], 10)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1
  const count = b - a + 1
  // Sanity cap — a nonsensical range (e.g. a resolution/CRC digit pair misread as a range)
  // should never inflate the floor to something absurd.
  return count > 0 && count < 2000 ? count : 1
}

export interface UpscaleCheck {
  suspicious: boolean
  reason: string | null
}

/**
 * Only fires for a release whose parsed resolution is 2160p — returns suspicious:false for
 * everything else (including unparseable resolution). This is a targeted "fake 4K" check,
 * not a general quality gate.
 */
export function detectSuspiciousUpscale(
  resolution: string | null,
  mediaType: 'movie' | 'tv',
  sizeBytes: number,
  title: string,
): UpscaleCheck {
  if ((resolution ?? '').toLowerCase() !== '2160p') return { suspicious: false, reason: null }
  if (!sizeBytes || sizeBytes <= 0) return { suspicious: false, reason: null }

  const floor =
    mediaType === 'movie'
      ? MOVIE_2160P_FLOOR_BYTES
      : EPISODE_2160P_FLOOR_BYTES * estimatePackEpisodeCount(title)

  if (sizeBytes < floor) {
    return {
      suspicious: true,
      reason: 'Claims 2160p but is far smaller than a real 4K source — likely an upscaled re-label',
    }
  }
  return { suspicious: false, reason: null }
}
