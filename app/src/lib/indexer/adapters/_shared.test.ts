import { describe, it, expect } from 'vitest'
import { normalizeInfoHash } from './_shared'

describe('normalizeInfoHash', () => {
  it('lowercases an already-hex hash', () => {
    expect(normalizeInfoHash('D7A46713EAEE18C746B3254B7D1492A50FD9D6CE'))
      .toBe('d7a46713eaee18c746b3254b7d1492a50fd9d6ce')
  })

  it('converts a Base32 BTIH to the equivalent canonical hex', () => {
    // Real SubsPlease magnet hash, cross-checked against Python's base64.b32decode.
    expect(normalizeInfoHash('K5WUYI2GJCGBFUTA4XCTAGPBD5RZKGQ5'))
      .toBe('576d4c2346488c12d260e5c53019e11f63951a1d')
  })

  it('is idempotent — normalizing an already-normalized hash is a no-op', () => {
    const hex = 'd7a46713eaee18c746b3254b7d1492a50fd9d6ce'
    expect(normalizeInfoHash(hex)).toBe(hex)
  })

  it('falls back to a lowercased pass-through for a malformed hash', () => {
    expect(normalizeInfoHash('not-a-real-hash')).toBe('not-a-real-hash')
  })

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeInfoHash('  D7A46713EAEE18C746B3254B7D1492A50FD9D6CE  '))
      .toBe('d7a46713eaee18c746b3254b7d1492a50fd9d6ce')
  })
})
