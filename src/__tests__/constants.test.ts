import { describe, it, expect } from 'vitest'
import { contactEmail, instagramUrl } from '../lib/constants'

describe('constants', () => {
  it('contactEmail is a valid email', () => {
    expect(contactEmail).toMatch(/.+@.+\..+/)
  })

  it('instagramUrl points to Instagram', () => {
    expect(instagramUrl).toContain('instagram.com')
  })
})
