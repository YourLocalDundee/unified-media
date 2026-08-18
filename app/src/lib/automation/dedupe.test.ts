import { describe, it, expect, vi } from 'vitest'
import type { DuplicateCandidate, DuplicateContext } from './dedupe'

// dedupe.ts reaches for the DB and the download client at module load; the ranking under test is
// pure (formatScore is supplied by the caller), so neither is exercised here.
vi.mock('@/lib/db/index', () => ({ getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }) }) }))
vi.mock('@/lib/download-client/registry', () => ({ getClient: () => ({ deleteTorrents: vi.fn() }) }))
vi.mock('./monitor', () => ({ getProfileById: () => undefined }))
vi.mock('./quality', () => ({ scoreWithProfile: () => ({ totalScore: 0 }) }))

import { pickWinner, nameProximity } from './dedupe'

function candidate(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    infoHash: 'aaaa',
    releaseTitle: 'Some.Movie.2019.1080p.WEB-DL.x264',
    seeders: 10,
    grabbedAt: 1_000,
    formatScore: 0,
    ...overrides,
  }
}

function ctx(overrides: Partial<DuplicateContext> = {}): DuplicateContext {
  return {
    title: 'Some Movie',
    year: 2019,
    conditions: [],
    language: 'any',
    audioMode: 'any',
    pickedHash: null,
    pickedTitle: null,
    ...overrides,
  }
}

describe('pickWinner', () => {
  // The 2026-08-16 incident in miniature: the user hand-picked a 1080p release, the automation
  // grabbed a 4K one off the same item, and the library ended up with the release nobody chose.
  it('keeps the release the user explicitly picked over anything the automation grabbed', () => {
    const picked = candidate({ infoHash: 'user1080p', releaseTitle: 'Some.Movie.2019.1080p.WEB-DL.x264', seeders: 3 })
    const auto = candidate({ infoHash: 'auto2160p', releaseTitle: 'Some.Movie.2019.2160p.WEB-DL.x265', seeders: 400, grabbedAt: 2_000 })

    const winner = pickWinner([auto, picked], ctx({ pickedHash: 'user1080p' }))
    expect(winner?.infoHash).toBe('user1080p')
  })

  it('matches the user pick by release title when the pick carried no hash', () => {
    const picked = candidate({ infoHash: 'nohash-side', releaseTitle: 'Some Movie 2019 1080p WEB-DL x264' })
    const auto = candidate({ infoHash: 'auto2160p', releaseTitle: 'Some.Movie.2019.2160p.WEB-DL.x265', seeders: 900 })

    const winner = pickWinner([auto, picked], ctx({ pickedTitle: 'Some.Movie.2019.1080p.WEB-DL.x264' }))
    expect(winner?.infoHash).toBe('nohash-side')
  })

  it('prefers the release matching the profile conditions when there is no user pick', () => {
    const wanted = candidate({ infoHash: 'is1080p', releaseTitle: 'Some.Movie.2019.1080p.WEB-DL.x264', seeders: 5 })
    const other = candidate({ infoHash: 'is2160p', releaseTitle: 'Some.Movie.2019.2160p.WEB-DL.x265', seeders: 500 })

    const winner = pickWinner([other, wanted], ctx({
      conditions: [{ type: 'resolution', value: '1080p', required: true }],
    }))
    expect(winner?.infoHash).toBe('is1080p')
  })

  // "Any" (profile id 1) carries no conditions — the profile in play during the incident. Nothing
  // discriminates at the profile step, so ranking must FALL THROUGH rather than call it a tie and
  // take whichever release happened to be looked at first.
  it('falls through to the later keys when the profile has no conditions', () => {
    const strayName = candidate({ infoHash: 'stray', releaseTitle: 'Totally.Different.Film.2011.1080p', seeders: 900 })
    const rightName = candidate({ infoHash: 'right', releaseTitle: 'Some.Movie.2019.1080p.WEB-DL.x264', seeders: 4 })

    expect(pickWinner([strayName, rightName], ctx())?.infoHash).toBe('right')
  })

  it('ranks the format score above seeders once names are equally close', () => {
    const scored = candidate({ infoHash: 'scored', formatScore: 50, seeders: 2 })
    const seeded = candidate({ infoHash: 'seeded', formatScore: 0, seeders: 900 })

    expect(pickWinner([seeded, scored], ctx())?.infoHash).toBe('scored')
  })

  it('honours a language preference before falling through to seeders', () => {
    const french = candidate({ infoHash: 'fr', releaseTitle: 'Some.Movie.2019.FRENCH.1080p.WEB-DL', seeders: 1 })
    const plain = candidate({ infoHash: 'en', releaseTitle: 'Some.Movie.2019.1080p.WEB-DL', seeders: 800 })

    expect(pickWinner([plain, french], ctx({ language: 'fr' }))?.infoHash).toBe('fr')
  })

  // Determinism matters: this decides which torrent gets deleted with its data, so identical
  // inputs must always resolve the same way rather than depending on row order.
  it('breaks a total tie on the earliest grab, in either input order', () => {
    const first = candidate({ infoHash: 'bbbb', grabbedAt: 1_000 })
    const second = candidate({ infoHash: 'aaaa', grabbedAt: 5_000 })

    expect(pickWinner([first, second], ctx())?.infoHash).toBe('bbbb')
    expect(pickWinner([second, first], ctx())?.infoHash).toBe('bbbb')
  })

  it('returns undefined for an empty candidate list', () => {
    expect(pickWinner([], ctx())).toBeUndefined()
  })
})

describe('nameProximity', () => {
  it('scores an exact title+year match above a same-title different-year release', () => {
    const right = nameProximity('Some.Movie.2019.1080p.WEB-DL', 'Some Movie', 2019)
    const wrongYear = nameProximity('Some.Movie.2011.1080p.WEB-DL', 'Some Movie', 2019)
    expect(right).toBeGreaterThan(wrongYear)
  })

  it('is 0 for every candidate when the item has no usable title, so the key cannot discriminate', () => {
    expect(nameProximity('Some.Movie.2019.1080p', '', null)).toBe(0)
  })
})
