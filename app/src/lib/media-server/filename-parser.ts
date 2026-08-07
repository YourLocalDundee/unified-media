import type { ParsedFilename } from './types'

const QUALITY_TAGS = /\s+(?:Blu[-.]?ray|BDRip|WEB[-.]?(?:DL|Rip)?|HDTV|DVDRip|HDRip|x26[45]|HEVC|AVC|AAC|AC3|DTS|FLAC|MP3|H\.?26[45]|\d{3,4}p|2160p|4K|UHD|PROPER|EXTENDED|REMASTERED|THEATRICAL|DIRECTORS|UNRATED|\[.*).*/i

function cleanEpisodeTitle(raw: string): string | null {
  const cleaned = raw
    .replace(QUALITY_TAGS, '')
    .replace(/^[-\s·–—]+/, '')
    .replace(/[._]/g, ' ')
    .trim()
  return cleaned || null
}

export function parseFilename(filename: string): ParsedFilename {
  // Cap input length to bound regex backtracking time on adversarial names (A21-04).
  const safeFilename = filename.length > 512 ? filename.slice(0, 512) : filename
  const base = safeFilename.replace(/\.[^.]+$/, '')

  // S01E02 pattern. Episode capture must allow 3 digits — some long-running shows
  // zero-pad within-season episode numbers to 3 digits (e.g. "S01E010"); a 2-digit-max
  // capture truncates that to "01", colliding every E01x episode onto episode 1.
  const tvMatch = base.match(/^(.+?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,3})/i)
  if (tvMatch) {
    const rawTitle = tvMatch[1].replace(/[._]/g, ' ').trim()
    const season = parseInt(tvMatch[2], 10)
    const episode = parseInt(tvMatch[3], 10)
    const yearMatch = rawTitle.match(/\b(19\d{2}|20[012]\d)\b/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null
    const title = rawTitle.replace(/\s*\(?\d{4}\)?\s*$/, '').trim()
    const afterSE = base.slice(tvMatch[0].length)
    const episodeTitle = cleanEpisodeTitle(afterSE)
    return { title, episodeTitle, year, season, episode, isEpisode: true }
  }

  // "Show Episode NNN Title" (e.g. "Naruto Shippuden Episode 033 The New Target")
  const episodeWordMatch = base.match(/^(.+?)\s+Episode\s+(\d{2,4})(?:\s+(.+))?$/i)
  if (episodeWordMatch) {
    const rawTitle = episodeWordMatch[1].replace(/[._]/g, ' ').trim()
    const episode = parseInt(episodeWordMatch[2], 10)
    const yearMatch = rawTitle.match(/\(?(19\d{2}|20[012]\d)\)?/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null
    const title = rawTitle.replace(/\s*\(?\d{4}\)?\s*$/, '').trim()
    const episodeTitle = episodeWordMatch[3] ? cleanEpisodeTitle(episodeWordMatch[3]) : null
    return { title, episodeTitle, year, season: 1, episode, isEpisode: true }
  }

  // "NxNN" pattern (e.g. "1x02"), optionally prefixed by a redundant absolute-episode
  // number: "Show - 002-1x02 - Title" or "Show - 1x02 - Title". Distinct from the S01E02
  // case above (no literal S/E letters) — common on older dub releases (e.g. Pokémon).
  const nxnMatch = base.match(/^(.+?)\s+-\s+(?:\d{2,4}-)?(\d{1,2})x(\d{1,3})(?:\s+-\s+(.+))?$/i)
  if (nxnMatch) {
    const rawTitle = nxnMatch[1].replace(/[._]/g, ' ').trim()
    const season = parseInt(nxnMatch[2], 10)
    const episode = parseInt(nxnMatch[3], 10)
    const yearMatch = rawTitle.match(/\b(19\d{2}|20[012]\d)\b/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null
    const title = rawTitle.replace(/\s*\(?\d{4}\)?\s*$/, '').trim()
    const episodeTitle = nxnMatch[4] ? cleanEpisodeTitle(nxnMatch[4]) : null
    return { title, episodeTitle, year, season, episode, isEpisode: true }
  }

  // Anime: "[Group] Show - 416 - Episode Title" or "Show - NNN - Title"
  const animeMatch = base.match(/^(?:\[.+?\]\s*)?(.+?)\s+-\s+(\d{2,4})\s+-\s+(.+)$/)
  if (animeMatch) {
    const rawTitle = animeMatch[1].replace(/[._]/g, ' ').trim()
    const episode = parseInt(animeMatch[2], 10)
    const yearMatch = rawTitle.match(/\(?(19\d{2}|20[012]\d)\)?/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null
    const title = rawTitle.replace(/\s*\(?\d{4}\)?\s*$/, '').trim()
    const episodeTitle = cleanEpisodeTitle(animeMatch[3])
    return { title, episodeTitle, year, season: 1, episode, isEpisode: true }
  }

  // Anime: "[Group] Show - NNN" (no episode title suffix)
  const animeSimple = base.match(/^(?:\[.+?\]\s*)?(.+?)\s+-\s+(\d{2,4})$/)
  if (animeSimple) {
    const rawTitle = animeSimple[1].replace(/[._]/g, ' ').trim()
    const episode = parseInt(animeSimple[2], 10)
    const yearMatch = rawTitle.match(/\(?(19\d{2}|20[012]\d)\)?/)
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null
    const title = rawTitle.replace(/\s*\(?\d{4}\)?\s*$/, '').trim()
    return { title, episodeTitle: null, year, season: 1, episode, isEpisode: true }
  }

  // Movie: Title.Year.Quality or Title (Year)
  const yearMatch = base.match(/\b(19\d{2}|20[012]\d)\b/)
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null
  const beforeYear = yearMatch
    ? base.slice(0, base.indexOf(yearMatch[1]))
    : base
  const title = beforeYear.replace(/[._]/g, ' ').replace(/[^a-zA-Z0-9\s'-]/g, '').trim()

  return { title: title || base, episodeTitle: null, year, season: null, episode: null, isEpisode: false }
}
