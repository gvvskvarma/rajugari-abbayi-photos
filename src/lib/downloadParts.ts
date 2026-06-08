import type { DeliveryAsset } from '../types'

/**
 * Max bytes per zip part. Each part is a SEPARATE download request, so it gets
 * its own fresh memory + CPU budget — keeping every download comfortably under
 * Cloudflare's Free-plan limits no matter how large the delivery is. Splitting
 * a 5.67GB delivery into ~1.5GB parts means no single request ever approaches
 * the ceiling. Tune here if the plan changes.
 */
export const MAX_PART_BYTES = Math.round(1.5 * 1024 * 1024 * 1024) // 1.5 GB

export type DownloadPart = {
  /** 1-based part number. */
  index: number
  /** Total number of parts. */
  total: number
  assetIds: string[]
  bytes: number
}

/**
 * Pack assets into size-capped parts. Whole files only — a single file is
 * never split across parts (so a part may slightly exceed the cap if one file
 * alone is larger, which is fine: it just gets its own part). Returns a single
 * part when the total is under the cap.
 */
export function splitIntoDownloadParts(assets: DeliveryAsset[], cap = MAX_PART_BYTES): DownloadPart[] {
  const buckets: Array<{ ids: string[]; bytes: number }> = []
  let current: { ids: string[]; bytes: number } | null = null

  for (const asset of assets) {
    const size = asset.bytes || 0
    if (current && current.bytes + size > cap && current.ids.length > 0) {
      buckets.push(current)
      current = null
    }
    if (!current) current = { ids: [], bytes: 0 }
    current.ids.push(asset.id)
    current.bytes += size
  }
  if (current && current.ids.length) buckets.push(current)

  return buckets.map((b, i) => ({
    index: i + 1,
    total: buckets.length,
    assetIds: b.ids,
    bytes: b.bytes,
  }))
}

/** Human-readable size, e.g. "1.4 GB" / "780 MB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
