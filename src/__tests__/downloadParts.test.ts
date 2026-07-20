import { describe, it, expect } from 'vitest'
import { splitIntoDownloadParts, MAX_PART_BYTES } from '../lib/downloadParts'
import type { DeliveryAsset } from '../types'

const GB = 1024 * 1024 * 1024
const asset = (id: string, bytes: number): DeliveryAsset => ({
  id, filename: `${id}.jpg`, mime_type: 'image/jpeg', bytes,
})

describe('splitIntoDownloadParts', () => {
  it('returns a single part when total is under the cap', () => {
    const parts = splitIntoDownloadParts([asset('a', 100), asset('b', 200)])
    expect(parts).toHaveLength(1)
    expect(parts[0].total).toBe(1)
    expect(parts[0].assetIds).toEqual(['a', 'b'])
    expect(parts[0].bytes).toBe(300)
  })

  it('splits a 5.67GB delivery into multiple ~1.5GB parts', () => {
    // 125 files of ~46MB ≈ 5.67GB
    const files = Array.from({ length: 125 }, (_, i) => asset(`f${i}`, 46 * 1024 * 1024))
    const parts = splitIntoDownloadParts(files)
    expect(parts.length).toBeGreaterThan(1)
    // every part is at or under the cap
    for (const p of parts) expect(p.bytes).toBeLessThanOrEqual(MAX_PART_BYTES)
    // every file is included exactly once, order preserved
    const ids = parts.flatMap((p) => p.assetIds)
    expect(ids).toEqual(files.map((f) => f.id))
    expect(parts.every((p) => p.total === parts.length)).toBe(true)
  })

  it('puts a single oversized file in its own part without looping', () => {
    const parts = splitIntoDownloadParts([asset('big', 3 * GB), asset('small', 10)])
    expect(parts).toHaveLength(2)
    expect(parts[0].assetIds).toEqual(['big'])
    expect(parts[1].assetIds).toEqual(['small'])
  })

  it('never splits a single file across parts', () => {
    const files = [asset('a', 1.2 * GB), asset('b', 1.2 * GB), asset('c', 1.2 * GB)]
    const parts = splitIntoDownloadParts(files)
    for (const p of parts) {
      for (const id of p.assetIds) expect(['a', 'b', 'c']).toContain(id)
    }
    expect(parts.flatMap((p) => p.assetIds).sort()).toEqual(['a', 'b', 'c'])
  })
})
