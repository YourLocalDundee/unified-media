import { describe, it, expect, vi, beforeEach } from 'vitest'

// Captures every parameter object handed to a prepared statement's .run(), so a test can assert
// on what the enricher actually wrote rather than on which TMDB calls it happened to make.
const written: Record<string, unknown>[] = []
vi.mock('@/lib/db/index', () => ({
  getDb: () => ({
    prepare: () => ({
      run: (params: Record<string, unknown>) => written.push(params),
      all: () => [],
      get: () => undefined,
    }),
  }),
}))

const searchTV = vi.fn()
const getTV = vi.fn()
const searchMovie = vi.fn()
const getMovie = vi.fn()
vi.mock('./tmdb', () => ({
  searchTV: (...a: unknown[]) => searchTV(...a),
  getTV: (...a: unknown[]) => getTV(...a),
  searchMovie: (...a: unknown[]) => searchMovie(...a),
  getMovie: (...a: unknown[]) => getMovie(...a),
  getSeasonEpisodeDetails: vi.fn(),
}))

// A /search/tv hit: deliberately WITHOUT external_ids or genres, which is what TMDB really sends.
const tvSearchHit = { id: 31910, name: 'Naruto Shippuden', first_air_date: '2007-02-15' }
// The matching /tv/{id} response, which does carry them.
const tvDetail = {
  ...tvSearchHit,
  external_ids: { tvdb_id: 79824 },
  genres: [{ id: 16, name: 'Animation' }],
}

const movieSearchHit = { id: 671, title: 'Philosopher', release_date: '2001-11-16' }
const movieDetail = {
  ...movieSearchHit,
  imdb_id: 'tt0241527',
  runtime: 152,
  genres: [{ id: 12, name: 'Adventure' }],
}

async function enrich(item: Record<string, unknown>) {
  written.length = 0
  const { enrichItem } = await import('./enricher')
  await enrichItem(item as never)
  return written[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  searchTV.mockResolvedValue(tvSearchHit)
  getTV.mockResolvedValue(tvDetail)
  searchMovie.mockResolvedValue(movieSearchHit)
  getMovie.mockResolvedValue(movieDetail)
})

describe('enrichItem — series', () => {
  it('writes tvdb_id, which only the detail response carries', async () => {
    const row = await enrich({ id: 'a', type: 'series', title: 'Naruto Shippuden', year: null })
    expect(getTV).toHaveBeenCalledWith(31910)
    expect(row.tvdb_id).toBe(79824)
  })

  it('writes genres, also detail-only', async () => {
    const row = await enrich({ id: 'a', type: 'series', title: 'Naruto Shippuden', year: null })
    expect(row.genres).toBe(JSON.stringify(['Animation']))
  })

  // The regression this whole change exists to prevent: enriching straight off the search result
  // silently yields tvdb_id = null, because /search/tv has no external_ids field at all.
  it('would have written null without the detail fetch', () => {
    expect((tvSearchHit as { external_ids?: unknown }).external_ids).toBeUndefined()
  })

  it('falls back to the search result when the detail call fails', async () => {
    getTV.mockRejectedValue(new Error('TMDB 503'))
    const row = await enrich({ id: 'a', type: 'series', title: 'Naruto Shippuden', year: null })
    expect(row.tmdb_id).toBe(31910) // still matched and written
    expect(row.tvdb_id).toBeNull() // degraded, not crashed
  })

  it('writes nothing when the search finds no match', async () => {
    searchTV.mockResolvedValue(null)
    const row = await enrich({ id: 'a', type: 'series', title: 'Nonexistent', year: null })
    expect(getTV).not.toHaveBeenCalled()
    expect(row).toBeUndefined()
  })
})

describe('enrichItem — movies', () => {
  it('writes imdb_id, runtime and genres, all detail-only', async () => {
    const row = await enrich({ id: 'm', type: 'movie', title: 'Philosopher', year: 2001 })
    expect(getMovie).toHaveBeenCalledWith(671)
    expect(row.imdb_id).toBe('tt0241527')
    expect(row.runtime_ticks).toBe(152 * 600_000_000)
    expect(row.genres).toBe(JSON.stringify(['Adventure']))
  })

  it('falls back to the search result when the detail call fails', async () => {
    getMovie.mockRejectedValue(new Error('TMDB 503'))
    const row = await enrich({ id: 'm', type: 'movie', title: 'Philosopher', year: 2001 })
    expect(row.tmdb_id).toBe(671)
    expect(row.imdb_id).toBeNull()
    expect(row.runtime_ticks).toBeNull()
  })
})
