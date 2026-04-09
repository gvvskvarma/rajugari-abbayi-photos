import { describe, it, expect } from 'vitest'
import {
  toFirstName,
  getAssetKind,
  daysRemainingText,
  randomToken,
} from '../lib/helpers'

describe('toFirstName', () => {
  it('extracts and capitalises the first name', () => {
    expect(toFirstName('vishnu varma')).toBe('Vishnu')
  })

  it('handles single name', () => {
    expect(toFirstName('alice')).toBe('Alice')
  })

  it('handles separators like dots and hyphens', () => {
    expect(toFirstName('jean-luc.picard')).toBe('Jean')
  })

  it('returns empty string for undefined', () => {
    expect(toFirstName(undefined)).toBe('')
  })

  it('returns empty string for blank input', () => {
    expect(toFirstName('   ')).toBe('')
  })
})

describe('getAssetKind', () => {
  it('detects images', () => {
    expect(getAssetKind('image/jpeg')).toBe('images')
    expect(getAssetKind('image/png')).toBe('images')
  })

  it('detects videos', () => {
    expect(getAssetKind('video/mp4')).toBe('videos')
  })

  it('falls back to other', () => {
    expect(getAssetKind('application/pdf')).toBe('other')
  })
})

describe('daysRemainingText', () => {
  it('returns "Not started" for null', () => {
    expect(daysRemainingText(null)).toBe('Not started')
  })

  it('returns "Expired" for past date', () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(daysRemainingText(past)).toBe('Expired')
  })

  it('returns days remaining for future date', () => {
    const future = new Date(Date.now() + 3 * 86400000).toISOString()
    expect(daysRemainingText(future)).toMatch(/Expires in \d+ days?/)
  })
})

describe('randomToken', () => {
  it('returns a 48-character hex string', () => {
    const token = randomToken()
    expect(token).toMatch(/^[0-9a-f]{48}$/)
  })

  it('generates unique tokens', () => {
    const a = randomToken()
    const b = randomToken()
    expect(a).not.toBe(b)
  })
})
