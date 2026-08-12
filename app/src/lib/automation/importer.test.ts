import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MonitoredItem } from './types'

// importer.ts pulls in the DB and the notifier at module load; neither is exercised by the
// path helper under test.
vi.mock('@/lib/db/index', () => ({ getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }) }) }))
vi.mock('./monitor', () => ({ updateItem: vi.fn() }))
vi.mock('@/lib/notify/available', () => ({
  collectAvailableNotifications: () => [],
  notifyAll: vi.fn(),
}))

// MEDIA_ROOTS is read once at module load, so each case has to set the env and re-import.
async function importWithRoots(roots: string | undefined) {
  vi.resetModules()
  if (roots === undefined) delete process.env.MEDIA_ROOTS
  else process.env.MEDIA_ROOTS = roots
  return import('./importer')
}

function item(overrides: Partial<MonitoredItem> = {}): MonitoredItem {
  return { id: 1, title: 'Some Title', type: 'movie', year: 2001, ...overrides } as MonitoredItem
}

const ORIGINAL_ROOTS = process.env.MEDIA_ROOTS

describe('buildTargetPath', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    if (ORIGINAL_ROOTS === undefined) delete process.env.MEDIA_ROOTS
    else process.env.MEDIA_ROOTS = ORIGINAL_ROOTS
  })

  // The regression this file exists for: the importer used to write to hardcoded paths that no
  // container actually mounted, so imports silently vanished instead of failing. Targets must
  // come from MEDIA_ROOTS — the same setting the scanner indexes — and nothing else.
  it('places items inside the configured MEDIA_ROOTS, not a hardcoded path', async () => {
    const { buildTargetPath } = await importWithRoots('/srv/media/movies:/srv/media/tv')
    expect(buildTargetPath(item())).toBe('/srv/media/movies/Some Title (2001)')
    expect(buildTargetPath(item({ type: 'tv', year: null }))).toBe('/srv/media/tv/Some Title')
  })

  it('follows MEDIA_ROOTS when the library moves', async () => {
    const { buildTargetPath } = await importWithRoots('/mnt/library/movies:/mnt/library/tv')
    expect(buildTargetPath(item())).toBe('/mnt/library/movies/Some Title (2001)')
  })

  it('returns undefined rather than guessing when no root matches the media type', async () => {
    const { buildTargetPath } = await importWithRoots('/srv/media/music')
    expect(buildTargetPath(item())).toBeUndefined()
    expect(buildTargetPath(item({ type: 'tv' }))).toBeUndefined()
  })

  it('returns undefined when MEDIA_ROOTS is unset', async () => {
    const { buildTargetPath } = await importWithRoots(undefined)
    expect(buildTargetPath(item())).toBeUndefined()
  })

  it('omits the year suffix when the item has none', async () => {
    const { buildTargetPath } = await importWithRoots('/srv/media/movies:/srv/media/tv')
    expect(buildTargetPath(item({ year: null }))).toBe('/srv/media/movies/Some Title')
  })

  it('strips path separators and other unsafe characters from the title', async () => {
    const { buildTargetPath } = await importWithRoots('/srv/media/movies:/srv/media/tv')
    expect(buildTargetPath(item({ title: 'Face/Off: The "Sequel"?', year: 2026 })))
      .toBe('/srv/media/movies/Face-Off- The -Sequel-- (2026)')
  })

  it('tolerates whitespace and trailing slashes in MEDIA_ROOTS', async () => {
    const { buildTargetPath } = await importWithRoots(' /srv/media/movies/ : /srv/media/tv ')
    expect(buildTargetPath(item())).toBe('/srv/media/movies/Some Title (2001)')
  })
})
