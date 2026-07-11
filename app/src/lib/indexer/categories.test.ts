import { describe, it, expect } from 'vitest'
import { resolveCategoriesForIndexer } from './categories'

describe('resolveCategoriesForIndexer', () => {
  it('passes the requested cats through unchanged when the indexer has never been probed (caps null)', () => {
    expect(resolveCategoriesForIndexer(null, '5000')).toBe('5000')
  })

  it('passes the requested cats through unchanged when caps JSON is malformed', () => {
    expect(resolveCategoriesForIndexer('not json', '5000')).toBe('5000')
  })

  it('keeps the requested top-level id when the indexer explicitly advertises it', () => {
    const caps = JSON.stringify([{ id: '5000', name: 'TV' }])
    expect(resolveCategoriesForIndexer(caps, '5000')).toBe('5000')
  })

  it('never drops the requested id even when the indexer advertises nothing at all', () => {
    const caps = JSON.stringify([])
    expect(resolveCategoriesForIndexer(caps, '5000')).toBe('5000')
  })

  it('appends a known standard subcat when the parent id is missing but the subcat is advertised', () => {
    // Indexer's caps never mention bare 5000, but do advertise 5040 (TV/HD) as a subcat.
    const caps = JSON.stringify([{ id: '2000', name: 'Movies', subcats: [{ id: '2040', name: 'Movies/HD' }] }, { id: '5040', name: 'TV/HD' }])
    expect(resolveCategoriesForIndexer(caps, '5000')).toBe('5000,5040')
  })

  it('appends a subcat found nested under a different top-level category entry', () => {
    const caps = JSON.stringify([{ id: '2000', name: 'Movies', subcats: [{ id: '2040', name: 'Movies/HD' }] }])
    expect(resolveCategoriesForIndexer(caps, '2000')).toBe('2000')
  })

  it('is additive across a multi-category request, only appending for the id that is missing', () => {
    const caps = JSON.stringify([{ id: '2000', name: 'Movies' }, { id: '5045', name: 'TV/UHD' }])
    expect(resolveCategoriesForIndexer(caps, '2000,5000')).toBe('2000,5000,5045')
  })

  it('does not duplicate an id that is already in the requested list', () => {
    const caps = JSON.stringify([{ id: '5040', name: 'TV/HD' }])
    expect(resolveCategoriesForIndexer(caps, '5000,5040')).toBe('5000,5040')
  })
})
