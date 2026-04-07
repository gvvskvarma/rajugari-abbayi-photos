import type {
  UploadItem,
  UploadQueueGroup,
  FileSystemEntryLike,
  FileSystemFileEntryLike,
  FileSystemDirectoryEntryLike,
  DataTransferItemWithEntry,
} from '../types'

const normalizeUploadPath = (path: string, fallbackName: string) => {
  const cleaned = path.trim().replace(/^\/+/, '')
  return cleaned || fallbackName
}

const uploadItemKey = (item: UploadItem) => `${item.path}::${item.file.size}::${item.file.lastModified}`

export const dedupeUploadItems = (items: UploadItem[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = uploadItemKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const normalizeUploadItemPath = (path: string) => path.trim().replace(/^\/+/, '')

export const buildUploadQueueGroups = (items: UploadItem[]) => {
  const groups = new Map<string, UploadItem[]>()
  const order: string[] = []

  for (const item of items) {
    const normalizedPath = normalizeUploadItemPath(item.path)
    const segments = normalizedPath.split('/').filter(Boolean)
    const key = segments.length > 1 ? `folder:${segments[0]}` : `file:${normalizedPath}`
    if (!groups.has(key)) order.push(key)

    const current = groups.get(key) ?? []
    current.push({
      ...item,
      path: normalizedPath,
    })
    groups.set(key, current)
  }

  return order.map((key): UploadQueueGroup => {
    const groupItems = groups.get(key) ?? []
    const firstItem = groupItems[0]
    const firstSegments = firstItem ? firstItem.path.split('/').filter(Boolean) : []
    const isFolder = firstSegments.length > 1
    const displayLabel = isFolder ? (key.replace(/^folder:/, '') || firstItem?.path || key) : firstItem?.path ?? key

    return {
      key,
      label: displayLabel,
      count: groupItems.length,
      isFolder,
      items: groupItems,
    }
  })
}

export const getDisplayFileName = (value: string) => {
  const cleaned = value.trim().replace(/\/+$/, '')
  const segments = cleaned.split('/').filter(Boolean)
  return segments[segments.length - 1] || cleaned
}

export const sanitizeDownloadName = (value: string) => {
  const cleaned = getDisplayFileName(value).replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || 'download'
}

const readDirectoryEntries = async (directoryEntry: FileSystemDirectoryEntryLike) => {
  const reader = directoryEntry.createReader()
  const entries: FileSystemEntryLike[] = []

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    if (!batch.length) break
    entries.push(...batch)
  }

  return entries
}

const collectEntryUploadItems = async (entry: FileSystemEntryLike): Promise<UploadItem[]> => {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntryLike
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject)
    })
    return [{ file, path: normalizeUploadPath(entry.fullPath, file.name) }]
  }

  if (entry.isDirectory) {
    const directoryEntry = entry as FileSystemDirectoryEntryLike
    const children = await readDirectoryEntries(directoryEntry)
    const nested = await Promise.all(children.map((child) => collectEntryUploadItems(child)))
    return nested.flat()
  }

  return []
}

export const collectDroppedUploadItems = async (dataTransfer: DataTransfer): Promise<UploadItem[]> => {
  const items = Array.from(dataTransfer.items ?? [])

  if (!items.length) {
    return Array.from(dataTransfer.files ?? []).map((file) => ({
      file,
      path: file.name,
    }))
  }

  const collected = await Promise.all(
    items.map(async (item) => {
      const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.()
      if (entry) {
        return collectEntryUploadItems(entry)
      }

      const file = item.getAsFile()
      return file
        ? [
            {
              file,
              path: file.name,
            },
          ]
        : []
    })
  )

  const flattened = collected.flat()
  if (flattened.length) {
    return flattened
  }

  return Array.from(dataTransfer.files ?? []).map((file) => ({
    file,
    path: file.name,
  }))
}
