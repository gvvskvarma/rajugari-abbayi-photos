export type UploadItem = {
  file: File
  path: string
}

export type UploadQueueGroup = {
  key: string
  label: string
  count: number
  isFolder: boolean
  items: UploadItem[]
}

export type FileSystemEntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
}

export type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (success: (file: File) => void, error?: (error: unknown) => void) => void
}

export type FileSystemDirectoryReaderLike = {
  readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: unknown) => void) => void
}

export type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike
}

export type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null
}
