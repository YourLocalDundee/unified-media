import { describe, it, expect } from 'vitest'
import { detectSuspiciousUpscale } from './fake-upscale'

const GB = 1024 ** 3

describe('detectSuspiciousUpscale', () => {
  it('never fires for a non-2160p resolution claim', () => {
    expect(detectSuspiciousUpscale('1080p', 'movie', 100 * 1024, 'Movie.1080p')).toEqual({
      suspicious: false,
      reason: null,
    })
    expect(detectSuspiciousUpscale(null, 'tv', 100 * 1024, 'Show - 01')).toEqual({
      suspicious: false,
      reason: null,
    })
  })

  it('flags a 2160p movie release far below the genuine-4K size floor', () => {
    const result = detectSuspiciousUpscale('2160p', 'movie', 0.8 * GB, 'Old.Movie.2160p.WEB-DL')
    expect(result.suspicious).toBe(true)
    expect(result.reason).toMatch(/upscaled/i)
  })

  it('does not flag a genuine-sized 2160p movie release', () => {
    const result = detectSuspiciousUpscale('2160p', 'movie', 15 * GB, 'Movie.2160p.BluRay.REMUX')
    expect(result).toEqual({ suspicious: false, reason: null })
  })

  it('flags a single undersized 2160p TV episode', () => {
    const result = detectSuspiciousUpscale('2160p', 'tv', 0.2 * GB, 'Show - S01E01 2160p')
    expect(result.suspicious).toBe(true)
  })

  it('does not flag a genuine-sized single 2160p TV episode, even a compact anime-style encode', () => {
    // ~1GB for a single episode comfortably clears the permissive floor.
    const result = detectSuspiciousUpscale('2160p', 'tv', 1 * GB, 'Show - S01E01 2160p')
    expect(result).toEqual({ suspicious: false, reason: null })
  })

  it('scales the floor by parsed episode count for a season/arc pack', () => {
    // 24 episodes at a genuine ~0.6GB/ep floor = ~14.4GB; well under that total should flag.
    const undersizedPack = detectSuspiciousUpscale('2160p', 'tv', 2 * GB, 'Show 01-24 2160p Batch')
    expect(undersizedPack.suspicious).toBe(true)

    // Comfortably over the scaled floor for the same 24-episode range should not flag.
    const genuinePack = detectSuspiciousUpscale('2160p', 'tv', 20 * GB, 'Show 01-24 2160p Batch')
    expect(genuinePack).toEqual({ suspicious: false, reason: null })
  })

  it('treats an unparseable range as a single item rather than inflating the floor', () => {
    // No numeric range in the title — single-episode floor applies, so this modest size passes.
    const result = detectSuspiciousUpscale('2160p', 'tv', 1 * GB, 'Show - Special 2160p')
    expect(result).toEqual({ suspicious: false, reason: null })
  })

  it('never fires for a zero or missing size', () => {
    expect(detectSuspiciousUpscale('2160p', 'movie', 0, 'Movie.2160p')).toEqual({
      suspicious: false,
      reason: null,
    })
  })
})
