import { describe, it, expect, afterEach } from 'vitest'
import { isAdminNetwork } from './admin-network'

const ORIGINAL = process.env.ADMIN_ALLOWED_CIDRS

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_ALLOWED_CIDRS
  else process.env.ADMIN_ALLOWED_CIDRS = ORIGINAL
})

describe('isAdminNetwork defaults', () => {
  it('allows the tailnet (100.64.0.0/10)', () => {
    expect(isAdminNetwork('100.100.100.100')).toBe(true)
    expect(isAdminNetwork('100.90.10.20')).toBe(true)
    expect(isAdminNetwork('100.64.0.0')).toBe(true)      // first address
    expect(isAdminNetwork('100.127.255.255')).toBe(true) // last address
  })

  it('rejects addresses just outside the tailnet range', () => {
    expect(isAdminNetwork('100.63.255.255')).toBe(false)
    expect(isAdminNetwork('100.128.0.0')).toBe(false)
  })

  it('allows the LAN and the box itself', () => {
    expect(isAdminNetwork('<lan-ip>')).toBe(true)  // the server
    expect(isAdminNetwork('<lan-ip>')).toBe(true)  // a LAN client
    expect(isAdminNetwork('172.20.0.1')).toBe(true)   // docker gateway — how local logins appear
    expect(isAdminNetwork('127.0.0.1')).toBe(true)
    expect(isAdminNetwork('::1')).toBe(true)
  })

  it('rejects the public internet', () => {
    // Documentation-range addresses (RFC 5737) on purpose — this repo is public, so the real
    // edge address does not belong in it.
    expect(isAdminNetwork('203.0.113.7')).toBe(false)
    expect(isAdminNetwork('198.51.100.4')).toBe(false)
    expect(isAdminNetwork('8.8.8.8')).toBe(false)
    expect(isAdminNetwork('10.20.10.10')).toBe(false)    // different private /24
  })

  it('rejects malformed input rather than passing it', () => {
    expect(isAdminNetwork('')).toBe(false)
    expect(isAdminNetwork('not-an-ip')).toBe(false)
    expect(isAdminNetwork('10.10.10')).toBe(false)
    expect(isAdminNetwork('999.1.1.1')).toBe(false)
    expect(isAdminNetwork('2001:db8::1')).toBe(false) // IPv6 we cannot evaluate
  })

  it('unwraps IPv6-mapped IPv4', () => {
    expect(isAdminNetwork('::ffff:<lan-ip>')).toBe(true)
    expect(isAdminNetwork('::ffff:8.8.8.8')).toBe(false)
  })

  it('tolerates surrounding whitespace from a header split', () => {
    expect(isAdminNetwork('  100.100.100.100 ')).toBe(true)
  })
})

describe('ADMIN_ALLOWED_CIDRS override', () => {
  it('replaces the defaults', () => {
    process.env.ADMIN_ALLOWED_CIDRS = '192.168.1.0/24'
    expect(isAdminNetwork('192.168.1.7')).toBe(true)
    expect(isAdminNetwork('<lan-ip>')).toBe(false) // default no longer applies
  })

  it('accepts a bare address as a /32', () => {
    process.env.ADMIN_ALLOWED_CIDRS = '203.0.113.9'
    expect(isAdminNetwork('203.0.113.9')).toBe(true)
    expect(isAdminNetwork('203.0.113.10')).toBe(false)
  })

  it('0.0.0.0/0 disables the restriction', () => {
    process.env.ADMIN_ALLOWED_CIDRS = '0.0.0.0/0'
    expect(isAdminNetwork('8.8.8.8')).toBe(true)
  })

  it('falls back to the defaults when set to whitespace', () => {
    process.env.ADMIN_ALLOWED_CIDRS = '   '
    expect(isAdminNetwork('100.100.100.100')).toBe(true)
    expect(isAdminNetwork('8.8.8.8')).toBe(false)
  })
})
