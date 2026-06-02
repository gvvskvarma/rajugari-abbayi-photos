import { describe, it, expect } from 'vitest'
import { groupAssetsByFolder, UNGROUPED_KEY } from '../lib/folders'
import { uploadItemFolder } from '../lib/upload'
import type { DeliveryAsset } from '../types'

const asset = (id: string, folder: string | null): DeliveryAsset => ({
  id,
  filename: `${id}.jpg`,
  mime_type: 'image/jpeg',
  bytes: 100,
  folder,
})

describe('uploadItemFolder', () => {
  it('returns the top-level folder for a nested path', () => {
    expect(uploadItemFolder('Ceremony/IMG_001.jpg')).toBe('Ceremony')
    expect(uploadItemFolder('Reception/sub/IMG_002.jpg')).toBe('Reception')
  })
  it('returns null for a loose file', () => {
    expect(uploadItemFolder('IMG_001.jpg')).toBeNull()
    expect(uploadItemFolder('')).toBeNull()
  })
  it('ignores leading slashes', () => {
    expect(uploadItemFolder('/Ceremony/x.jpg')).toBe('Ceremony')
  })
})

describe('groupAssetsByFolder', () => {
  it('treats a single folder (no loose files) as flat', () => {
    const r = groupAssetsByFolder([asset('a', 'Ceremony'), asset('b', 'Ceremony')])
    expect(r.hasFolders).toBe(false)
    expect(r.folderCount).toBe(1)
  })

  it('treats all-loose files as flat', () => {
    const r = groupAssetsByFolder([asset('a', null), asset('b', null)])
    expect(r.hasFolders).toBe(false)
    expect(r.folderCount).toBe(0)
  })

  it('groups 2+ folders and sorts named alpha with ungrouped last', () => {
    const r = groupAssetsByFolder([
      asset('a', 'Reception'),
      asset('b', 'Ceremony'),
      asset('c', null),
      asset('d', 'Ceremony'),
    ])
    expect(r.hasFolders).toBe(true)
    expect(r.folderCount).toBe(2)
    expect(r.groups.map((g) => g.key)).toEqual(['Ceremony', 'Reception', UNGROUPED_KEY])
    expect(r.groups[0].assets.map((a) => a.id)).toEqual(['b', 'd'])
    expect(r.groups[2].name).toBeNull()
  })

  it('shows folders when one named folder coexists with loose files', () => {
    const r = groupAssetsByFolder([asset('a', 'Ceremony'), asset('b', null)])
    expect(r.hasFolders).toBe(true)
  })
})
