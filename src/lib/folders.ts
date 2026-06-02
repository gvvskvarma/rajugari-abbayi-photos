import type { DeliveryAsset } from '../types'

export const UNGROUPED_KEY = '__ungrouped__'

export type FolderGroup = {
  /** Stable key for React + lookups (folder name, or UNGROUPED_KEY). */
  key: string
  /** Display name, or null for loose files dropped outside any folder. */
  name: string | null
  assets: DeliveryAsset[]
}

/**
 * Group a delivery's assets by their `folder` field. Named folders come
 * first (alphabetical), loose files ("Unsorted") last.
 *
 * `hasFolders` is true only when there's meaningful grouping — 2+ named
 * folders, or 1 named folder alongside loose files. A delivery whose files
 * are all in a single folder (or all loose) renders flat, exactly as before.
 */
export function groupAssetsByFolder(assets: DeliveryAsset[]): {
  groups: FolderGroup[]
  hasFolders: boolean
  folderCount: number
} {
  const map = new Map<string, DeliveryAsset[]>()
  for (const asset of assets) {
    const key = asset.folder && asset.folder.trim() ? asset.folder.trim() : UNGROUPED_KEY
    const list = map.get(key)
    if (list) list.push(asset)
    else map.set(key, [asset])
  }

  const named = [...map.keys()].filter((k) => k !== UNGROUPED_KEY).sort((a, b) => a.localeCompare(b))
  const orderedKeys = map.has(UNGROUPED_KEY) ? [...named, UNGROUPED_KEY] : named

  const groups: FolderGroup[] = orderedKeys.map((key) => ({
    key,
    name: key === UNGROUPED_KEY ? null : key,
    assets: map.get(key) ?? [],
  }))

  const folderCount = named.length
  const hasFolders = folderCount >= 2 || (folderCount >= 1 && map.has(UNGROUPED_KEY))
  return { groups, hasFolders, folderCount }
}
