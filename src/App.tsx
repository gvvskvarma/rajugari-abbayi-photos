import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const instagramUrl =
  'https://www.instagram.com/rajugari_abbayi_photography?igsh=azYxaHdwYmdhaTh0&utm_source=qr'
const personalInstagramUrl =
  'https://www.instagram.com/rajugari_abbayi?igsh=MTB3MHk4ODZxODM5dg%3D%3D&utm_source=qr'

const mediaBaseUrl = (import.meta.env.VITE_MEDIA_BASE_URL ?? '').trim().replace(/\/+$/, '')
const authRedirectUrl =
  (import.meta.env.VITE_AUTH_REDIRECT_URL ?? '').trim() || 'https://rajugariabbayishots.vercel.app'
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')

const toFirstName = (value?: string) => {
  const cleaned = (value ?? '').trim()
  if (!cleaned) return ''
  const firstToken = cleaned.split(/[\s._-]+/)[0] ?? ''
  if (!firstToken) return ''
  return firstToken.charAt(0).toUpperCase() + firstToken.slice(1).toLowerCase()
}

const localMediaAssetUrls = import.meta.glob(
  '/project-rga/optimized/**/*.{jpg,jpeg,JPG,JPEG,png,PNG,webp,WEBP}',
  {
    eager: true,
    import: 'default',
    query: '?url',
  }
) as Record<string, string>

const normalizeMediaPath = (path: string) => path.replace(/^\/+/, '')

const toRemoteMediaUrl = (path: string) => {
  if (!mediaBaseUrl) return undefined
  if (/^https?:\/\//.test(path)) return path
  return `${mediaBaseUrl}/${normalizeMediaPath(path)}`
}

const toLocalMediaUrl = (path: string) => {
  const key = `/${normalizeMediaPath(path)}`
  return localMediaAssetUrls[key]
}

const buildSrcSet = (variants: Array<{ url?: string; width: number }>) => {
  const srcSet = variants
    .filter((variant): variant is { url: string; width: number } => Boolean(variant.url))
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(', ')
  return srcSet || undefined
}

const uniqueSources = (sources: Array<{ src?: string; srcSet?: string }>) => {
  const seen = new Set<string>()
  return sources
    .filter((source): source is { src: string; srcSet?: string } => Boolean(source.src))
    .filter((source) => {
      if (seen.has(source.src)) return false
      seen.add(source.src)
      return true
    })
}

type UploadItem = {
  file: File
  path: string
}

type UploadQueueGroup = {
  key: string
  label: string
  count: number
  isFolder: boolean
  items: UploadItem[]
}

type FileSystemEntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath: string
}

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (success: (file: File) => void, error?: (error: unknown) => void) => void
}

type FileSystemDirectoryReaderLike = {
  readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: unknown) => void) => void
}

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null
}

const normalizeUploadPath = (path: string, fallbackName: string) => {
  const cleaned = path.trim().replace(/^\/+/, '')
  return cleaned || fallbackName
}

const uploadItemKey = (item: UploadItem) => `${item.path}::${item.file.size}::${item.file.lastModified}`

const dedupeUploadItems = (items: UploadItem[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = uploadItemKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const normalizeUploadItemPath = (path: string) => path.trim().replace(/^\/+/, '')

const buildUploadQueueGroups = (items: UploadItem[]) => {
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

const collectDroppedUploadItems = async (dataTransfer: DataTransfer): Promise<UploadItem[]> => {
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

type ResponsiveAsset = {
  key: string
  sources: Array<{
    src: string
    srcSet?: string
  }>
}

const createResponsiveAsset = (originalPath: string): ResponsiveAsset => {
  const normalizedPath = normalizeMediaPath(originalPath)
  const optimizedBase = normalizedPath
    .replace(/^project-rga\//, 'project-rga/optimized/')
    .replace(/\.[^.]+$/, '')

  const remote640 = toRemoteMediaUrl(`${optimizedBase}-640.jpg`)
  const remote1200 = toRemoteMediaUrl(`${optimizedBase}-1200.jpg`)
  const remote1800 = toRemoteMediaUrl(`${optimizedBase}-1800.jpg`)

  const local640 = toLocalMediaUrl(`${optimizedBase}-640.jpg`)
  const local1200 = toLocalMediaUrl(`${optimizedBase}-1200.jpg`)
  const local1800 = toLocalMediaUrl(`${optimizedBase}-1800.jpg`)

  const remoteSrcSet = buildSrcSet([
    { url: remote640, width: 640 },
    { url: remote1200, width: 1200 },
    { url: remote1800, width: 1800 },
  ])

  const localSrcSet = buildSrcSet([
    { url: local640, width: 640 },
    { url: local1200, width: 1200 },
    { url: local1800, width: 1800 },
  ])

  const sources = uniqueSources([
    { src: remote640, srcSet: remoteSrcSet },
    { src: local640, srcSet: localSrcSet },
    { src: remote1200 },
    { src: local1200 },
    { src: remote1800 },
    { src: local1800 },
  ])

  return {
    key: normalizedPath,
    sources,
  }
}

type ResponsiveImageProps = {
  asset: ResponsiveAsset
  alt: string
  className?: string
  sizes: string
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
}

const ResponsiveImage = ({
  asset,
  alt,
  className,
  sizes,
  loading = 'lazy',
  fetchPriority = 'auto',
}: ResponsiveImageProps) => {
  const candidates = useMemo(() => asset.sources, [asset.sources])

  const [candidateIndex, setCandidateIndex] = useState(0)

  useEffect(() => {
    setCandidateIndex(0)
  }, [asset])

  const candidate = candidates[Math.min(candidateIndex, Math.max(candidates.length - 1, 0))]
  if (!candidate) return null

  return (
    <img
      className={className}
      src={candidate.src}
      srcSet={candidate.srcSet}
      sizes={candidate.srcSet ? sizes : undefined}
      alt={alt}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      onError={() =>
        setCandidateIndex((current) => Math.min(current + 1, Math.max(candidates.length - 1, 0)))
      }
    />
  )
}

type GalleryShot = {
  image: ResponsiveAsset
  title: string
  tag: string
}

type Role = 'admin' | 'customer'
type AppView = 'home' | 'my-pictures' | 'upload' | 'share' | 'admin-clients' | 'admin-client'

type DeliveryAsset = {
  id: string
  filename: string
  mime_type: string
  bytes: number
  delivery_id?: string
  r2_object_key?: string
  created_at?: string
  canView?: boolean
  canDownload?: boolean
}

type DeliveryCard = {
  deliveryId: string
  expiresAt: string | null
  firstViewedAt?: string | null
  accessMode?: 'owner' | 'viewer' | 'admin'
  assets: DeliveryAsset[]
}

type AdminClient = {
  id: string
  full_name: string
  email: string
  phone: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

type AdminProject = {
  id: string
  client_id: string
  name: string
  description: string | null
  shoot_date: string | null
  location: string | null
  status: string
  created_at: string
  updated_at: string
}

type AdminAsset = {
  id: string
  project_id: string
  delivery_id: string | null
  filename: string
  mime_type: string
  bytes: number
  r2_object_key: string
  created_at: string
}

type AdminClientSummary = AdminClient & {
  projects: AdminProject[]
  assets: AdminAsset[]
  projectCount: number
  assetCount: number
  latestUpdatedAt: string
}

type AdminProjectView = {
  project: AdminProject
  totalAssets: number
  visibleAssets: AdminAsset[]
  latestActivityAt: string
}

const landscapePaths = [
  'project-rga/landscapes/RGA02744.jpg',
  'project-rga/landscapes/RGA02755.jpg',
  'project-rga/landscapes/RGA02761.jpg',
  'project-rga/landscapes/RGA02807.jpg',
  'project-rga/landscapes/RGA03800.jpg',
]

const featuredShots: GalleryShot[] = [
  {
    image: createResponsiveAsset(landscapePaths[0]),
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    image: createResponsiveAsset(landscapePaths[1]),
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    image: createResponsiveAsset(landscapePaths[2]),
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    image: createResponsiveAsset(landscapePaths[3]),
    title: 'North Cascades',
    tag: 'Landscape',
  },
  {
    image: createResponsiveAsset(landscapePaths[4]),
    title: 'San Francisco',
    tag: 'Landscape',
  },
]

const babyImages = [
  'project-rga/potraits/baby/RGA03628.jpg',
  'project-rga/potraits/baby/RGA03631.jpg',
  'project-rga/potraits/baby/RGA03639.jpg',
  'project-rga/potraits/baby/RGA03656.jpg',
  'project-rga/potraits/baby/RGA03664.jpg',
  'project-rga/potraits/baby/RGA03667.jpg',
].map(createResponsiveAsset)

const portraitImages = [
  'project-rga/potraits/potraits/RGA04154.jpg',
  'project-rga/potraits/potraits/RGA04156.jpg',
  'project-rga/potraits/potraits/RGA04170-2.jpg',
  'project-rga/potraits/potraits/RGA04174-2.jpg',
  'project-rga/potraits/potraits/RGA04188-2.jpg',
  'project-rga/potraits/potraits/RGA04203-2.jpg',
  'project-rga/potraits/potraits/RGA04280.jpg',
  'project-rga/potraits/potraits/RGA04306-4.jpg',
].map(createResponsiveAsset)

const eventImages = [
  'project-rga/potraits/events/RGA03248-2.jpg',
  'project-rga/potraits/events/RGA03250.jpg',
  'project-rga/potraits/events/RGA03281.jpg',
  'project-rga/potraits/events/RGA03341.jpg',
  'project-rga/potraits/events/RGA03884.jpg',
  'project-rga/potraits/events/RGA03886.jpg',
  'project-rga/potraits/events/RGA03898.jpg',
  'project-rga/potraits/events/RGA03987.jpg',
  'project-rga/potraits/events/RGA03994.jpg',
  'project-rga/potraits/events/RGA04058.jpg',
  'project-rga/potraits/events/RGA04064.jpg',
  'project-rga/potraits/events/RGA04135.jpg',
  'project-rga/potraits/events/RGA04158.jpg',
  'project-rga/potraits/events/RGA04191.jpg',
  'project-rga/potraits/events/RGA04205.jpg',
].map(createResponsiveAsset)

const heroPortrait = createResponsiveAsset('project-rga/potraits/events/RGA03248-2.jpg')
const heroLandscape = featuredShots[0]?.image
const heroTravel = featuredShots[4]?.image ?? featuredShots[2]?.image

const getPrimaryPreloadSource = (asset: ResponsiveAsset) => asset.sources[0]?.src ?? ''

const readViewFromHash = () => {
  const hash = window.location.hash || '#home'
  if (hash.startsWith('#share/')) return 'share'
  if (hash === '#my-pictures') return 'my-pictures'
  if (hash === '#upload') return 'upload'
  if (hash.startsWith('#admin-clients/')) return 'admin-client'
  if (hash === '#admin-clients' || hash === '#admin-work') return 'admin-clients'
  return 'home'
}

const readAdminClientIdFromHash = () => {
  const hash = window.location.hash || ''
  if (!hash.startsWith('#admin-clients/')) return ''
  return hash.replace('#admin-clients/', '').split('/')[0]?.trim() ?? ''
}

const readShareTokenFromHash = () => {
  const hash = window.location.hash || ''
  if (!hash.startsWith('#share/')) return ''
  return hash.replace('#share/', '').trim()
}

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

const daysRemainingText = (expiresAt: string | null) => {
  if (!expiresAt) return 'Not started'
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return 'Expired'
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return `Expires in ${days} day${days === 1 ? '' : 's'}`
}

const randomToken = () => {
  const buffer = new Uint8Array(24)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}

type RotatingGalleryProps = {
  title: string
  subtitle: string
  images: ResponsiveAsset[]
  cycleStep: number
}

const RotatingGallery = ({
  title,
  subtitle,
  images,
  cycleStep,
}: RotatingGalleryProps) => {
  const [displayIndex, setDisplayIndex] = useState(0)
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    if (images.length === 0) {
      setDisplayIndex(0)
      setIncomingIndex(null)
      setIsTransitioning(false)
      return
    }
    setDisplayIndex((current) => current % images.length)
  }, [images.length])

  useEffect(() => {
    if (images.length === 0 || isTransitioning || incomingIndex !== null) return
    const nextIndex = cycleStep % images.length
    if (nextIndex === displayIndex) return

    let canceled = false
    const preloadImage = new Image()
    preloadImage.src = getPrimaryPreloadSource(images[nextIndex])

    const beginTransition = () => {
      if (canceled) return
      setIncomingIndex(nextIndex)
      setIsTransitioning(true)
    }

    if (typeof preloadImage.decode === 'function') {
      preloadImage.decode().then(beginTransition).catch(beginTransition)
    } else {
      preloadImage.onload = beginTransition
      preloadImage.onerror = beginTransition
    }

    return () => {
      canceled = true
    }
  }, [cycleStep, displayIndex, images, incomingIndex, isTransitioning])

  useEffect(() => {
    if (!isTransitioning || incomingIndex === null) return
    const timeout = window.setTimeout(() => {
      setDisplayIndex(incomingIndex % images.length)
      setIncomingIndex(null)
      setIsTransitioning(false)
    }, 520)
    return () => window.clearTimeout(timeout)
  }, [images.length, incomingIndex, isTransitioning])

  const active = images.length > 0 ? images[displayIndex % images.length] : undefined
  const incoming =
    incomingIndex !== null && images.length > 0 ? images[incomingIndex % images.length] : undefined

  return (
    <div className="rotator">
      <div className="rotator-card">
        {active ? (
          <div className="rotator-image-stack">
            <ResponsiveImage
              asset={active}
              alt={title}
              className="rotator-image"
              sizes="(max-width: 900px) 92vw, 33vw"
            />
            {incoming && isTransitioning && (
              <ResponsiveImage
                asset={incoming}
                alt={title}
                className="rotator-image rotator-image-enter"
                sizes="(max-width: 900px) 92vw, 33vw"
              />
            )}
          </div>
        ) : (
          <div className="rotator-placeholder">
            <p>Add {title} photos</p>
            <span>Add files to project-rga folders</span>
          </div>
        )}
        <div className="rotator-overlay">
          <p>{title}</p>
          <span>{subtitle}</span>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [cycleStep, setCycleStep] = useState(0)
  const [authMenuOpen, setAuthMenuOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [profileDisplayName, setProfileDisplayName] = useState('')
  const [session, setSession] = useState<{ user: { id: string; email?: string } } | null>(null)
  const [role, setRole] = useState<Role>('customer')

  const [view, setView] = useState<AppView>(readViewFromHash())
  const [shareToken, setShareToken] = useState(readShareTokenFromHash())

  const [myDeliveries, setMyDeliveries] = useState<DeliveryCard[]>([])
  const [customerError, setCustomerError] = useState('')
  const [customerBusy, setCustomerBusy] = useState(false)
  const [newShareLinks, setNewShareLinks] = useState<Record<string, string>>({})
  const [shareCopyState, setShareCopyState] = useState<Record<string, string>>({})

  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadClientMode, setUploadClientMode] = useState<'create' | 'reuse'>('create')
  const [uploadEmail, setUploadEmail] = useState('')
  const [uploadTitle, setUploadTitle] = useState('Client Delivery')
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
  const [uploadDropActive, setUploadDropActive] = useState(false)
  const uploadDragDepthRef = useRef(0)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [adminClients, setAdminClients] = useState<AdminClientSummary[]>([])
  const [selectedAdminClientId, setSelectedAdminClientId] = useState(readAdminClientIdFromHash())
  const [adminClientSearch, setAdminClientSearch] = useState('')
  const [adminClientEditMode, setAdminClientEditMode] = useState(false)
  const [adminClientDraft, setAdminClientDraft] = useState({
    fullName: '',
    email: '',
    phone: '',
    notes: '',
  })
  const [adminAssetSearch, setAdminAssetSearch] = useState('')
  const [adminProjectSort, setAdminProjectSort] = useState<'recent' | 'name' | 'files'>('recent')
  const [selectedAdminAssetIds, setSelectedAdminAssetIds] = useState<string[]>([])
  const [adminAssetPreviewUrls, setAdminAssetPreviewUrls] = useState<Record<string, string>>({})
  const [adminAssetEditingId, setAdminAssetEditingId] = useState('')
  const [adminAssetDraftName, setAdminAssetDraftName] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminError, setAdminError] = useState('')

  const [shareAssets, setShareAssets] = useState<DeliveryAsset[]>([])
  const [shareBusy, setShareBusy] = useState(false)
  const [shareMessage, setShareMessage] = useState('')

  const loadAdminData = async () => {
    if (!supabase || !session?.user.id || role !== 'admin') return

    setAdminBusy(true)
    setAdminError('')

    try {
      const [clientsResult, projectsResult, assetsResult] = await Promise.all([
        supabase
          .from('clients')
          .select('id, full_name, email, phone, notes, created_at, updated_at')
          .eq('owner_user_id', session.user.id)
          .order('updated_at', { ascending: false }),
        supabase
          .from('projects')
          .select('id, client_id, name, description, shoot_date, location, status, created_at, updated_at')
          .eq('owner_user_id', session.user.id)
          .order('updated_at', { ascending: false }),
        supabase
          .from('assets')
          .select('id, project_id, delivery_id, filename, mime_type, bytes, r2_object_key, created_at')
          .eq('owner_user_id', session.user.id)
          .order('created_at', { ascending: false }),
      ])

      if (clientsResult.error) throw clientsResult.error
      if (projectsResult.error) throw projectsResult.error
      if (assetsResult.error) throw assetsResult.error

      const clients = (clientsResult.data ?? []) as AdminClient[]
      const projects = (projectsResult.data ?? []) as AdminProject[]
      const assets = (assetsResult.data ?? []) as AdminAsset[]

      const projectsByClient = new Map<string, AdminProject[]>()
      for (const project of projects) {
        const current = projectsByClient.get(project.client_id) ?? []
        current.push(project)
        projectsByClient.set(project.client_id, current)
      }

      const assetsByProject = new Map<string, AdminAsset[]>()
      for (const asset of assets) {
        const current = assetsByProject.get(asset.project_id) ?? []
        current.push(asset)
        assetsByProject.set(asset.project_id, current)
      }

      const summaries: AdminClientSummary[] = clients.map((clientRow) => {
        const clientProjects = projectsByClient.get(clientRow.id) ?? []
        const clientAssets = clientProjects.flatMap((project) => assetsByProject.get(project.id) ?? [])
        const latestUpdatedAt =
          [clientRow.updated_at, ...clientProjects.map((project) => project.updated_at), ...clientAssets.map((asset) => asset.created_at)]
            .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? clientRow.updated_at

        return {
          ...clientRow,
          projects: clientProjects,
          assets: clientAssets,
          projectCount: clientProjects.length,
          assetCount: clientAssets.length,
          latestUpdatedAt,
        }
      })

      setAdminClients(summaries)
      setSelectedAdminClientId((current) => current || summaries[0]?.id || '')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to load admin data')
    } finally {
      setAdminBusy(false)
    }
  }

  const selectedUploadClient = useMemo(() => {
    const normalizedEmail = uploadEmail.trim().toLowerCase()
    if (!normalizedEmail) return null
    return adminClients.find((client) => client.email.trim().toLowerCase() === normalizedEmail) ?? null
  }, [adminClients, uploadEmail])

  const reuseClientEmailOptions = useMemo(() => {
    const seen = new Set<string>()
    return adminClients
      .map((client) => ({
        id: client.id,
        email: client.email.trim(),
        label: client.full_name.trim() || client.email.trim(),
      }))
      .filter((client) => {
        const key = client.email.toLowerCase()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((left, right) => left.email.localeCompare(right.email))
  }, [adminClients])

  const uploadQueueGroups = useMemo(() => buildUploadQueueGroups(uploadItems), [uploadItems])

  useEffect(() => {
    const id = window.setInterval(() => {
      setCycleStep((current) => current + 1)
    }, 2000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onHashChange = () => {
      setView(readViewFromHash())
      setShareToken(readShareTokenFromHash())
      setSelectedAdminClientId(readAdminClientIdFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!supabase) return
    const client = supabase

    const boot = async () => {
      const { data } = await client.auth.getSession()
      const nextSession = data.session
      if (!nextSession?.user) {
        setSession(null)
        setRole('customer')
        setProfileDisplayName('')
        return
      }
      setSession({ user: { id: nextSession.user.id, email: nextSession.user.email ?? undefined } })
    }

    void boot()

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession?.user) {
        setSession(null)
        setRole('customer')
        setProfileDisplayName('')
        return
      }
      setSession({ user: { id: nextSession.user.id, email: nextSession.user.email ?? undefined } })
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user.id) return
    const client = supabase

    const fetchRole = async () => {
      const { data } = await client
        .from('profiles')
        .select('role, display_name')
        .eq('id', session.user.id)
        .single()

      if (!data) {
        setRole('customer')
        setProfileDisplayName('')
        return
      }

      setRole(data.role === 'admin' ? 'admin' : 'customer')
      setProfileDisplayName(data.display_name ?? '')
    }

    void fetchRole()
  }, [session?.user.id])

  const loginLabel = useMemo(() => {
    if (!session) return 'LOGIN'
    return toFirstName(profileDisplayName) || toFirstName(session.user.email) || 'LOGIN'
  }, [profileDisplayName, session])

  const filteredAdminClients = adminClients.filter((client) => {
    const query = adminClientSearch.trim().toLowerCase()
    if (!query) return true
    return [client.full_name, client.email, client.notes ?? '', client.projects.map((project) => project.name).join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const selectedAdminClient =
    adminClients.find((client) => client.id === selectedAdminClientId) ?? null

  const selectedAdminClientProjectViews = useMemo<AdminProjectView[]>(() => {
    if (!selectedAdminClient) return []

    const query = adminAssetSearch.trim().toLowerCase()
    const projectViews = selectedAdminClient.projects.map((project) => {
      const projectAssets = selectedAdminClient.assets.filter((asset) => asset.project_id === project.id)
      const visibleAssets = query
        ? projectAssets.filter((asset) =>
            [asset.filename, asset.mime_type, project.name].join(' ').toLowerCase().includes(query)
          )
        : projectAssets
      const latestActivityAt =
        [project.updated_at, ...projectAssets.map((asset) => asset.created_at)]
          .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? project.updated_at

      return {
        project,
        totalAssets: projectAssets.length,
        visibleAssets,
        latestActivityAt,
      }
    })

    projectViews.sort((left, right) => {
      if (adminProjectSort === 'name') {
        return left.project.name.localeCompare(right.project.name)
      }
      if (adminProjectSort === 'files') {
        return right.totalAssets - left.totalAssets
      }
      return new Date(right.latestActivityAt).getTime() - new Date(left.latestActivityAt).getTime()
    })

    return projectViews
  }, [adminAssetSearch, adminProjectSort, selectedAdminClient])

  const selectedAdminVisibleAssets = useMemo(
    () => selectedAdminClientProjectViews.flatMap((entry) => entry.visibleAssets),
    [selectedAdminClientProjectViews]
  )

  useEffect(() => {
    if (!selectedAdminClient) {
      setAdminClientEditMode(false)
      setAdminClientDraft({ fullName: '', email: '', phone: '', notes: '' })
      return
    }

    setAdminClientDraft({
      fullName: selectedAdminClient.full_name,
      email: selectedAdminClient.email,
      phone: selectedAdminClient.phone ?? '',
      notes: selectedAdminClient.notes ?? '',
    })
  }, [selectedAdminClient?.id])

  useEffect(() => {
    setSelectedAdminAssetIds((current) =>
      current.filter((assetId) => selectedAdminVisibleAssets.some((asset) => asset.id === assetId))
    )
  }, [selectedAdminVisibleAssets])

  useEffect(() => {
    if (!supabase || !session?.user.id || role !== 'admin' || selectedAdminVisibleAssets.length === 0) return

    const missingPreviewAssets = selectedAdminVisibleAssets.filter(
      (asset) => asset.mime_type.startsWith('image/') && !adminAssetPreviewUrls[asset.id]
    )
    if (missingPreviewAssets.length === 0) return

    let cancelled = false

    const loadPreviewUrls = async () => {
      const token = await getAccessToken()
      if (!token) return

      const entries = await Promise.all(
        missingPreviewAssets.map(async (asset) => {
          try {
            const payload = await workerRequest<{ signedUrl: string }>('/api/v1/media/signed-url', token, {
              method: 'POST',
              body: { assetId: asset.id, mode: 'view' },
            })
            return [asset.id, payload.signedUrl] as const
          } catch {
            return null
          }
        })
      )

      if (cancelled) return
      const previewEntries = Object.fromEntries(
        entries.filter((entry): entry is readonly [string, string] => entry !== null)
      )
      setAdminAssetPreviewUrls((current) => ({ ...current, ...previewEntries }))
    }

    void loadPreviewUrls()
    return () => {
      cancelled = true
    }
  }, [adminAssetPreviewUrls, role, selectedAdminVisibleAssets, session?.user.id])

  const openAdminClients = () => {
    window.location.hash = '#admin-clients'
    setView('admin-clients')
    setAdminClientEditMode(false)
    setAdminAssetSearch('')
    setSelectedAdminAssetIds([])
  }

  const openAdminClient = (clientId: string) => {
    setSelectedAdminClientId(clientId)
    setAdminClientEditMode(false)
    setAdminAssetSearch('')
    setSelectedAdminAssetIds([])
    window.location.hash = `#admin-clients/${clientId}`
  }

  const openUploadForClient = (client: AdminClientSummary) => {
    setUploadClientMode('reuse')
    setUploadEmail(client.email)
    setUploadTitle(client.full_name)
    setUploadItems([])
    window.location.hash = '#upload'
  }

  const getAccessToken = async () => {
    if (!supabase) return ''
    const {
      data: { session: authSession },
    } = await supabase.auth.getSession()
    return authSession?.access_token ?? ''
  }

  const workerRequest = async <T,>(
    path: string,
    token: string,
    options?: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
      body?: unknown
    }
  ): Promise<T> => {
    if (!apiBaseUrl) {
      throw new Error('Set VITE_API_BASE_URL to enable gallery APIs.')
    }
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })
    const text = await response.text()
    let payload: Record<string, unknown> = {}
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>
      } catch {
        if (response.ok) {
          throw new Error(`Unexpected response from server: ${text.slice(0, 120)}`)
        }
      }
    }
    if (!response.ok) {
      const maybeError = payload.error as { message?: string } | undefined
      throw new Error(maybeError?.message ?? (text.trim() || 'Request failed'))
    }
    return payload as T
  }

  useEffect(() => {
    if (!supabase || view !== 'my-pictures' || !session?.user.email) return

    const loadCustomerData = async () => {
      setCustomerBusy(true)
      setCustomerError('')
      try {
        const token = await getAccessToken()
        if (!token) {
          setCustomerError('Login session expired. Please log in again.')
          setMyDeliveries([])
          setCustomerBusy(false)
          return
        }
        const payload = await workerRequest<{ deliveries: DeliveryCard[] }>('/api/v1/my-pictures', token)
        setMyDeliveries(payload.deliveries ?? [])
      } catch (error) {
        setCustomerError(error instanceof Error ? error.message : 'Failed to load deliveries')
      } finally {
        setCustomerBusy(false)
      }
    }

    void loadCustomerData()
  }, [session?.user.email, view])

  useEffect(() => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    if (view !== 'upload' && view !== 'admin-clients' && view !== 'admin-client') return
    void loadAdminData()
  }, [role, session?.user.id, view])

  useEffect(() => {
    if (!supabase || view !== 'share' || !shareToken) return
    const client = supabase

    const loadShareView = async () => {
      setShareBusy(true)
      setShareMessage('')

      const linkResult = await client
        .from('share_links')
        .select('delivery_id, expires_at, allow_download')
        .eq('token', shareToken)
        .single()

      if (linkResult.error || !linkResult.data) {
        setShareMessage('This share link is invalid or unavailable.')
        setShareAssets([])
        setShareBusy(false)
        return
      }

      if (new Date(linkResult.data.expires_at).getTime() <= Date.now()) {
        setShareMessage('This share link has expired.')
        setShareAssets([])
        setShareBusy(false)
        return
      }

      const assetsResult = await client
        .from('assets')
        .select('id, delivery_id, filename, mime_type, bytes, r2_object_key, created_at')
        .eq('delivery_id', linkResult.data.delivery_id)
        .order('created_at', { ascending: false })

      if (assetsResult.error) {
        setShareMessage(assetsResult.error.message)
        setShareAssets([])
      } else {
        setShareAssets((assetsResult.data ?? []) as DeliveryAsset[])
      }

      setShareBusy(false)
    }

    void loadShareView()
  }, [shareToken, view])

  const handleSendOtp = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) {
      setAuthMessage('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable login.')
      return
    }

    const email = emailInput.trim().toLowerCase()
    if (!email) {
      setAuthMessage('Enter an email address first.')
      return
    }

    setAuthBusy(true)
    setAuthMessage('')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: authRedirectUrl,
      },
    })

    if (error) {
      setAuthMessage(error.message)
    } else {
      setAuthMessage('Magic link sent. Open your email to log in.')
    }

    setAuthBusy(false)
  }

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setAuthMenuOpen(false)
    setMyDeliveries([])
    setNewShareLinks({})
    window.location.hash = '#home'
  }

  const appendUploadItems = (items: UploadItem[]) => {
    setUploadItems((current) => dedupeUploadItems([...current, ...items]))
  }

  const handleUploadFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).map((file) => ({
      file,
      path: file.name,
    }))
    appendUploadItems(selected)
    event.target.value = ''
  }

  const handleUploadBrowseClick = () => {
    uploadInputRef.current?.click()
  }

  const handleUploadDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    uploadDragDepthRef.current = 0
    setUploadDropActive(false)
    try {
      const dropped = await collectDroppedUploadItems(event.dataTransfer)
      appendUploadItems(dropped)
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Unable to read dropped files')
    }
  }

  const handleUploadDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    uploadDragDepthRef.current += 1
    setUploadDropActive(true)
  }

  const handleUploadDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleUploadDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    uploadDragDepthRef.current = Math.max(0, uploadDragDepthRef.current - 1)
    if (uploadDragDepthRef.current === 0) {
      setUploadDropActive(false)
    }
  }

  const handleCreateShareLink = async (deliveryId: string) => {
    if (!supabase || !session?.user.id) return
    try {
      const token = await getAccessToken()
      if (!token) {
        setCustomerError('Login session expired. Please log in again.')
        return
      }
      const payload = await workerRequest<{ url: string }>(
        '/api/v1/share-links',
        token,
        {
          method: 'POST',
          body: { deliveryId, expiresInDays: 7 },
        }
      )
      setNewShareLinks((current) => ({ ...current, [deliveryId]: payload.url }))
      setShareCopyState((current) => ({ ...current, [deliveryId]: '' }))
    } catch (error) {
      setCustomerError(error instanceof Error ? error.message : 'Unable to create share link')
    }
  }

  const handleCopyShareLink = async (deliveryId: string) => {
    const link = newShareLinks[deliveryId]
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setShareCopyState((current) => ({ ...current, [deliveryId]: 'Copied' }))
    } catch {
      setShareCopyState((current) => ({ ...current, [deliveryId]: 'Copy failed' }))
    }
  }

  const handleOpenAsset = async (assetId: string, mode: 'view' | 'download') => {
    if (!supabase) return
    const reportError = role === 'admin' ? setAdminError : setCustomerError
    try {
      const token = await getAccessToken()
      if (!token) {
        reportError('Login session expired. Please log in again.')
        return
      }
      const payload = await workerRequest<{ signedUrl: string }>(
        '/api/v1/media/signed-url',
        token,
        {
          method: 'POST',
          body: { assetId, mode },
        }
      )
      window.open(payload.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      reportError(error instanceof Error ? error.message : 'Unable to open file')
    }
  }

  const handleRenameAdminAsset = async (assetId: string, nextName: string) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    const trimmedName = nextName.trim()
    if (!trimmedName) return

    const { error } = await supabase
      .from('assets')
      .update({ filename: trimmedName })
      .eq('id', assetId)
      .eq('owner_user_id', session.user.id)

    if (error) {
      setAdminError(error.message)
      return
    }

    setAdminClients((current) =>
      current.map((client) => ({
        ...client,
        assets: client.assets.map((asset) => (asset.id === assetId ? { ...asset, filename: trimmedName } : asset)),
      }))
    )
    setAdminAssetEditingId('')
    setAdminAssetDraftName('')
  }

  const handleDeleteAdminAsset = async (assetId: string) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    if (!window.confirm('Delete this file permanently? This cannot be undone.')) return

    try {
      const token = await getAccessToken()
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      await workerRequest<{ ok: boolean }>(`/api/v1/admin/assets/${assetId}`, token, { method: 'DELETE' })
      setAdminClients((current) =>
        current.map((client) => ({
          ...client,
          assets: client.assets.filter((asset) => asset.id !== assetId),
          assetCount: client.assets.filter((asset) => asset.id !== assetId).length,
        }))
      )
      setAdminAssetEditingId('')
      setAdminAssetDraftName('')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to delete file')
    }
  }

  const handleDeleteAdminProject = async (project: AdminProject) => {
    if (!supabase || !session?.user.id || role !== 'admin') return
    if (
      !window.confirm(
        `Delete folder ${project.name}? This removes the project, its uploaded files, and the matching customer folder data.`
      )
    ) {
      return
    }

    setAdminBusy(true)
    setAdminError('')

    try {
      const token = await getAccessToken()
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      await workerRequest<{ ok: boolean }>(`/api/v1/admin/projects/${project.id}`, token, {
        method: 'DELETE',
      })

      await loadAdminData()
      setSelectedAdminAssetIds([])
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to delete folder')
    } finally {
      setAdminBusy(false)
    }
  }

  const toggleSelectedAdminAsset = (assetId: string) => {
    setSelectedAdminAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
    )
  }

  const clearSelectedAdminAssets = () => setSelectedAdminAssetIds([])

  const selectVisibleAdminAssets = () =>
    setSelectedAdminAssetIds((current) => {
      const next = new Set(current)
      selectedAdminVisibleAssets.forEach((asset) => next.add(asset.id))
      return [...next]
    })

  const handleBulkDeleteAdminAssets = async () => {
    if (!supabase || !session?.user.id || role !== 'admin' || selectedAdminAssetIds.length === 0) return
    if (
      !window.confirm(
        `Delete ${selectedAdminAssetIds.length} selected file${selectedAdminAssetIds.length === 1 ? '' : 's'}? This cannot be undone.`
      )
    ) {
      return
    }

    setAdminBusy(true)
    setAdminError('')

    try {
      const token = await getAccessToken()
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      for (const assetId of selectedAdminAssetIds) {
        await workerRequest<{ ok: boolean }>(`/api/v1/admin/assets/${assetId}`, token, { method: 'DELETE' })
      }

      await loadAdminData()
      setSelectedAdminAssetIds([])
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to delete files')
    } finally {
      setAdminBusy(false)
    }
  }

  const handleSaveAdminClient = async () => {
    if (!supabase || !session?.user.id || role !== 'admin' || !selectedAdminClient) return

    const fullName = adminClientDraft.fullName.trim()
    const email = adminClientDraft.email.trim().toLowerCase()
    const phone = adminClientDraft.phone.trim()
    const notes = adminClientDraft.notes.trim()

    if (!fullName || !email) {
      setAdminError('Client full name and email are required.')
      return
    }

    setAdminBusy(true)
    setAdminError('')

    try {
      const token = await getAccessToken()
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      const updated = await workerRequest<{ client: AdminClient }>(
        `/api/v1/admin/clients/${selectedAdminClient.id}`,
        token,
        {
          method: 'PATCH',
          body: { fullName, email, phone, notes },
        }
      )

      setAdminClients((current) =>
        current.map((client) => (client.id === updated.client.id ? { ...client, ...updated.client } : client))
      )
      setSelectedAdminClientId(updated.client.id)
      setAdminClientEditMode(false)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to update client')
    } finally {
      setAdminBusy(false)
    }
  }

  const handleDeleteAdminClient = async () => {
    if (!supabase || !session?.user.id || role !== 'admin' || !selectedAdminClient) return
    if (
      !window.confirm(
        `Delete ${selectedAdminClient.full_name}? This removes the client, projects, deliveries, and uploaded files.`
      )
    ) {
      return
    }

    setAdminBusy(true)
    setAdminError('')

    try {
      const token = await getAccessToken()
      if (!token) {
        setAdminError('Login session expired. Please log in again.')
        return
      }

      await workerRequest<{ ok: boolean }>(`/api/v1/admin/clients/${selectedAdminClient.id}`, token, {
        method: 'DELETE',
      })

      setAdminClients((current) => current.filter((client) => client.id !== selectedAdminClient.id))
      setSelectedAdminClientId('')
      setAdminClientEditMode(false)
      setAdminAssetSearch('')
      window.location.hash = '#admin-clients'
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Unable to delete client')
    } finally {
      setAdminBusy(false)
    }
  }

  const uploadFileToSignedUrl = async (uploadUrl: string, file: File) => {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': file.type || 'application/octet-stream',
      },
      body: file,
    })
    if (!response.ok) {
      throw new Error(`Upload failed for ${file.name}`)
    }
  }

  const handleUploadDelivery = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session?.user.id) return

    const targetEmail = uploadEmail.trim().toLowerCase()
    if (!targetEmail || uploadItems.length === 0) {
      setUploadMessage('Enter a client email and add at least one file or folder item.')
      return
    }

    setUploadBusy(true)
    setUploadMessage('')

    const existingClient = await supabase
      .from('clients')
      .select('id')
      .eq('email', targetEmail)
      .eq('owner_user_id', session.user.id)
      .maybeSingle()

    if (existingClient.error) {
      setUploadMessage(existingClient.error.message)
      setUploadBusy(false)
      return
    }

    let clientId = existingClient.data?.id ?? ''

    if (uploadClientMode === 'create') {
      if (clientId) {
        setUploadMessage('That client already exists. Switch to Reuse existing.')
        setUploadBusy(false)
        return
      }

      const insertedClient = await supabase
        .from('clients')
        .insert({
          owner_user_id: session.user.id,
          full_name: targetEmail.split('@')[0] || 'Client',
          email: targetEmail,
        })
        .select('id')
        .single()

      if (insertedClient.error || !insertedClient.data) {
        setUploadMessage(insertedClient.error?.message ?? 'Unable to create client.')
        setUploadBusy(false)
        return
      }

      clientId = insertedClient.data.id
    } else if (!clientId) {
      setUploadMessage('No existing client found for that email. Switch to Create new.')
      setUploadBusy(false)
      return
    }

    const insertedProject = await supabase
      .from('projects')
      .insert({
        owner_user_id: session.user.id,
        client_id: clientId,
        name: uploadTitle || `Delivery ${new Date().toISOString().slice(0, 10)}`,
        status: 'active',
      })
      .select('id')
      .single()

    if (insertedProject.error || !insertedProject.data) {
      setUploadMessage(insertedProject.error?.message ?? 'Unable to create project.')
      setUploadBusy(false)
      return
    }

    const deliveryToken = randomToken()
    const insertedDelivery = await supabase
      .from('deliveries')
      .insert({
        owner_user_id: session.user.id,
        project_id: insertedProject.data.id,
        client_id: clientId,
        status: 'shared',
        access_token: deliveryToken,
        shared_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertedDelivery.error || !insertedDelivery.data) {
      setUploadMessage(insertedDelivery.error?.message ?? 'Unable to create delivery.')
      setUploadBusy(false)
      return
    }

    const recipientInsert = await supabase.from('delivery_recipients').insert({
      delivery_id: insertedDelivery.data.id,
      email: targetEmail,
      access_mode: 'owner',
    })

    if (recipientInsert.error) {
      setUploadMessage(recipientInsert.error.message)
      setUploadBusy(false)
      return
    }

    const token = await getAccessToken()
    if (!token) {
      setUploadMessage('Login session expired. Please log in again.')
      setUploadBusy(false)
      return
    }

    try {
      for (const item of uploadItems) {
        const uploadDisplayName = item.path.trim() || item.file.name
        const requestResult = await workerRequest<{
          objectKey: string
          uploadToken: string
          uploadUrl: string
        }>(
          '/api/v1/request-upload-url',
          token,
          {
            method: 'POST',
            body: {
              deliveryId: insertedDelivery.data.id,
              fileName: uploadDisplayName,
              contentType: item.file.type || 'application/octet-stream',
              fileSize: Math.max(1, item.file.size),
            },
          }
        )

        await uploadFileToSignedUrl(requestResult.uploadUrl, item.file)

        await workerRequest(
          '/api/v1/upload/complete',
          token,
          {
            method: 'POST',
            body: {
              deliveryId: insertedDelivery.data.id,
              objectKey: requestResult.objectKey,
              uploadToken: requestResult.uploadToken,
              fileName: uploadDisplayName,
              mimeType: item.file.type || 'application/octet-stream',
              bytes: Math.max(1, item.file.size),
            },
          }
        )
      }
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Upload failed')
      setUploadBusy(false)
      return
    }

    setUploadMessage(
      `Upload complete for ${targetEmail}. Opening the client folder now.`
    )
    setUploadItems([])
    setUploadEmail('')
    setUploadClientMode('create')
    setSelectedAdminClientId(clientId)
    window.location.hash = `#admin-clients/${clientId}`
    void loadAdminData()
    setUploadBusy(false)
  }

  const renderHomeSections = () => (
    <>
      <section id="home" className="hero">
        <div className="hero-text">
          <p className="eyebrow">Photography portfolio</p>
          <h1>Light, texture, and quiet moments — curated from my shoots.</h1>
          <p className="lead">
            I focus on landscapes, portraits, and the subtle details that make
            a scene feel alive. Browse the gallery and reach out to collaborate.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#work">
              View the work
            </a>
            <a className="button ghost" href="/book.html">
              Let’s collaborate
            </a>
          </div>
        </div>
        <div className="hero-cards">
          <div className="hero-card tall">
            <ResponsiveImage
              asset={heroPortrait}
              alt="Portrait"
              className="hero-card-image"
              sizes="(max-width: 900px) 92vw, 32vw"
              loading="eager"
              fetchPriority="high"
            />
            <div className="hero-card-overlay">
              <p>Portraits</p>
              <span>Studio & natural light</span>
            </div>
          </div>
          <div className="hero-card wide">
            {heroLandscape && (
              <ResponsiveImage
                asset={heroLandscape}
                alt="Landscape"
                className="hero-card-image"
                sizes="(max-width: 900px) 92vw, 66vw"
                loading="eager"
                fetchPriority="high"
              />
            )}
            <div className="hero-card-overlay">
              <p>Landscapes</p>
              <span>Golden hour stories</span>
            </div>
          </div>
          <div className="hero-card square">
            {heroTravel && (
              <ResponsiveImage
                asset={heroTravel}
                alt="Travel"
                className="hero-card-image"
                sizes="(max-width: 900px) 92vw, 32vw"
                loading="eager"
              />
            )}
            <div className="hero-card-overlay">
              <p>Travel</p>
              <span>Everyday poetry</span>
            </div>
          </div>
        </div>
      </section>

      <section id="work" className="work">
        <div className="section-head">
          <h2>Landscapes</h2>
          <p>
            A curated selection of my favorite scenes from the road. Each frame is a
            slow, cinematic moment.
          </p>
        </div>

        <div className="grid">
          {featuredShots.map((shot) => (
            <div key={shot.image.key} className="shot">
              <ResponsiveImage
                asset={shot.image}
                alt={shot.title}
                sizes="(max-width: 900px) 92vw, (max-width: 1200px) 44vw, 30vw"
              />
              <div className="shot-overlay">
                <p>{shot.title}</p>
                <span>{shot.tag}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="work-block">
          <div className="section-head">
            <h2>Portrait stories</h2>
            <p>
              Three rotating collections for baby portraits, classic portraits,
              and event moments.
            </p>
          </div>
          <div className="rotator-grid">
            <RotatingGallery
              title="BABY SHOOTS"
              subtitle="New beginnings"
              images={babyImages}
              cycleStep={cycleStep}
            />
            <RotatingGallery
              title="Portraits"
              subtitle="People & personality"
              images={portraitImages}
              cycleStep={cycleStep}
            />
            <RotatingGallery
              title="Events"
              subtitle="Milestones & energy"
              images={eventImages}
              cycleStep={cycleStep}
            />
          </div>
        </div>
      </section>

      <section id="about" className="about">
        <div>
          <h2>About the lens</h2>
          <p>
            I’m Vishnu Varma, a photographer focused on candid stories, textured light,
            and the quiet energy of people in their spaces. My work blends editorial
            composition with documentary honesty.
          </p>
        </div>
        <div className="about-card">
          <h3>Available for</h3>
          <ul>
            <li>Portrait sessions</li>
            <li>Brand campaigns</li>
            <li>Editorial shoots</li>
            <li>Travel collaborations</li>
          </ul>
        </div>
      </section>

      <section id="contact" className="contact">
        <div>
          <h2>Let’s build something beautiful</h2>
          <p>
            Want to book a shoot, collaborate, or hire me? Send a note and I’ll reply
            within two business days.
          </p>
          <div className="contact-actions">
            <a className="button primary" href="/book.html">
              Open contact form
            </a>
          </div>
        </div>
        <div className="contact-card">
          <div className="contact-item">
            <p className="muted">Email</p>
            <p className="contact-line">rgapics@gmail.com</p>
          </div>
          <div className="contact-item">
            <p className="muted">Instagram</p>
            <a className="contact-line" href={instagramUrl} target="_blank" rel="noreferrer">
              @rajugari_abbayi_photography
            </a>
          </div>
        </div>
      </section>
    </>
  )

  const renderMyPictures = () => {
    if (!session?.user.email) {
      return (
        <section className="portal-section">
          <h2>My Pictures</h2>
          <p>Log in with your email OTP to view your photos and videos.</p>
        </section>
      )
    }

    return (
      <section className="portal-section">
        <div className="portal-head">
          <div>
            <h2>My Pictures</h2>
            <p>Media matched to <strong>{session.user.email}</strong>.</p>
          </div>
        </div>

        {customerBusy && <p className="portal-hint">Loading your deliveries...</p>}
        {customerError && <p className="portal-error">{customerError}</p>}
        {!customerBusy && !customerError && myDeliveries.length === 0 && (
          <p className="portal-hint">No active deliveries found for this email.</p>
        )}

        <div className="delivery-list">
          {myDeliveries.map((delivery) => (
            <article key={delivery.deliveryId} className="delivery-card">
              <div className="delivery-header">
                <div>
                  <p className="delivery-title">Delivery {delivery.deliveryId.slice(0, 8)}</p>
                  <p className="delivery-expiry">{daysRemainingText(delivery.expiresAt)}</p>
                </div>
                <button
                  className="button ghost"
                  type="button"
                  disabled={delivery.accessMode === 'viewer'}
                  onClick={() => {
                    void handleCreateShareLink(delivery.deliveryId)
                  }}
                >
                  Create view-only link
                </button>
              </div>

              {newShareLinks[delivery.deliveryId] && (
                <div className="share-link-row">
                  <input className="share-link-input" value={newShareLinks[delivery.deliveryId]} readOnly />
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => {
                      void handleCopyShareLink(delivery.deliveryId)
                    }}
                  >
                    {shareCopyState[delivery.deliveryId] || 'Copy'}
                  </button>
                </div>
              )}

              <ul className="delivery-assets">
                {delivery.assets.map((asset) => (
                  <li key={asset.id}>
                    <span>{asset.filename}</span>
                    <span>{formatBytes(asset.bytes)}</span>
                    <div className="delivery-asset-actions">
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => {
                          void handleOpenAsset(asset.id, 'view')
                        }}
                      >
                        View
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        disabled={!asset.canDownload}
                        onClick={() => {
                          void handleOpenAsset(asset.id, 'download')
                        }}
                      >
                        Download
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    )
  }

  const renderUpload = () => {
    if (!session?.user.id) {
      return (
        <section className="portal-section admin-screen">
          <h2>Upload</h2>
          <p>Login required.</p>
        </section>
      )
    }

    if (role !== 'admin') {
      return (
        <section className="portal-section admin-screen">
          <h2>Upload</h2>
          <p className="portal-error">Only admin users can access uploads.</p>
        </section>
      )
    }

    return (
      <section className="portal-section admin-screen">
        <div className="portal-head admin-screen-head">
          <div>
            <p className="eyebrow">Admin upload</p>
            <h2>Upload to a client folder</h2>
            <p>Choose a client, drop files, then jump straight into that client’s folder.</p>
          </div>
          <button className="button ghost" type="button" onClick={openAdminClients}>
            View folders
          </button>
        </div>

        {adminBusy && <p className="portal-hint">Loading client folders...</p>}
        {adminError && <p className="portal-error">{adminError}</p>}

        <form className="admin-upload-layout" onSubmit={handleUploadDelivery}>
          <div className="admin-panel">
            <div className="admin-toggle" role="group" aria-label="Client folder mode">
              <button
                className={`admin-toggle-button ${uploadClientMode === 'create' ? 'is-active' : ''}`}
                type="button"
                onClick={() => setUploadClientMode('create')}
              >
                Create new
              </button>
              <button
                className={`admin-toggle-button ${uploadClientMode === 'reuse' ? 'is-active' : ''}`}
                type="button"
                onClick={() => setUploadClientMode('reuse')}
              >
                Reuse existing
              </button>
            </div>

            <label>
              Client email
              <input
                type="email"
                value={uploadEmail}
                onChange={(event) => setUploadEmail(event.target.value)}
                placeholder="client@example.com"
                required
              />
            </label>
            {uploadClientMode === 'reuse' && (
              <div className="admin-reuse-picker">
                <label>
                  Existing client email
                  <select
                    value={selectedUploadClient?.email ?? ''}
                    onChange={(event) => setUploadEmail(event.target.value)}
                    disabled={reuseClientEmailOptions.length === 0}
                  >
                    <option value="">Select an existing client</option>
                    {reuseClientEmailOptions.map((client) => (
                      <option key={client.id} value={client.email}>
                        {client.email} {client.label ? `- ${client.label}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {reuseClientEmailOptions.length === 0 ? (
                  <p className="portal-hint">No existing clients loaded yet. Use manual email entry below.</p>
                ) : (
                  <p className="portal-hint">Choose an email to reuse that client folder, or type one manually below.</p>
                )}
              </div>
            )}

            <label>
              Delivery title
              <input
                type="text"
                value={uploadTitle}
                onChange={(event) => setUploadTitle(event.target.value)}
                required
              />
            </label>

            <p className="portal-hint">
              {uploadClientMode === 'create'
                ? 'Create a new client folder using the email you enter.'
                : selectedUploadClient
                  ? `Files will be uploaded into ${selectedUploadClient.full_name}.`
                  : 'Enter or select an existing client email to reuse that folder.'}
            </p>
          </div>

          <div className="admin-panel">
            <div
              className={`admin-dropzone ${uploadDropActive ? 'is-active' : ''}`}
              onDragEnter={handleUploadDragEnter}
              onDragOver={handleUploadDragOver}
              onDragLeave={handleUploadDragLeave}
              onDrop={handleUploadDrop}
              role="presentation"
            >
              <input
                ref={uploadInputRef}
                className="admin-dropzone-input"
                type="file"
                multiple
                onChange={handleUploadFilesChange}
              />
              <div className="admin-dropzone-copy">
                <p className="eyebrow">Upload content</p>
                <h3>Drop files or folders here</h3>
                <p>
                  Drag a folder, drag individual files, or use the browse action to pick
                  multiple items.
                </p>
              </div>
              <div className="admin-dropzone-actions">
                <button className="button ghost" type="button" onClick={handleUploadBrowseClick}>
                  Browse files
                </button>
              </div>
            </div>

            {uploadQueueGroups.length > 0 && (
              <div className="admin-file-queue">
                {uploadQueueGroups.map((group) => (
                  <div key={group.key} className="admin-file-pill">
                    <div className="admin-file-pill-copy">
                      <span>{group.label}</span>
                      <small>{group.isFolder ? `${group.count} items` : 'Single file'}</small>
                    </div>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => {
                        setUploadItems((current) =>
                          current.filter((item) => {
                            const normalizedPath = normalizeUploadItemPath(item.path)
                            const segments = normalizedPath.split('/').filter(Boolean)
                            const key = segments.length > 1 ? `folder:${segments[0]}` : `file:${normalizedPath}`
                            return key !== group.key
                          })
                        )
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button className="button primary" type="submit" disabled={uploadBusy || uploadItems.length === 0}>
              {uploadBusy ? 'Creating delivery...' : 'Upload to client'}
            </button>
          </div>
        </form>

        {uploadMessage && <p className="portal-hint">{uploadMessage}</p>}
      </section>
    )
  }

  const renderAdminClients = () => {
    if (!session?.user.id || role !== 'admin') {
      return (
        <section className="portal-section admin-screen">
          <h2>Client folders</h2>
          <p className="portal-error">Only admin users can access this page.</p>
        </section>
      )
    }

    return (
      <section className="portal-section admin-screen">
        <div className="portal-head admin-screen-head">
          <div>
            <p className="eyebrow">Admin view</p>
            <h2>Client folders</h2>
            <p>Open a client to review uploads, rename files, or delete assets.</p>
          </div>
          <button
            className="button ghost"
            type="button"
            onClick={() => {
              setUploadClientMode('create')
              setUploadEmail('')
              setUploadTitle('Client Delivery')
              setUploadItems([])
              window.location.hash = '#upload'
            }}
          >
            New upload
          </button>
        </div>

        <div className="admin-stat-grid">
          <div className="admin-stat-card">
            <span>Clients</span>
            <strong>{adminClients.length}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Projects</span>
            <strong>{adminClients.reduce((count, client) => count + client.projectCount, 0)}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Files</span>
            <strong>{adminClients.reduce((count, client) => count + client.assetCount, 0)}</strong>
          </div>
        </div>

        <label className="admin-search">
          Search clients
          <input
            type="search"
            value={adminClientSearch}
            onChange={(event) => setAdminClientSearch(event.target.value)}
            placeholder="Search by client, email, or project"
          />
        </label>

        {adminBusy && <p className="portal-hint">Loading client folders...</p>}
        {adminError && <p className="portal-error">{adminError}</p>}
        {!adminBusy && !adminError && filteredAdminClients.length === 0 && (
          <p className="portal-hint">No client folders found yet.</p>
        )}

        <div className="admin-client-grid">
          {filteredAdminClients.map((client) => (
            <button
              key={client.id}
              className="admin-client-card"
              type="button"
              onClick={() => openAdminClient(client.id)}
            >
              <div className="admin-client-card-head">
                <div>
                  <p className="delivery-title">{client.full_name}</p>
                  <p className="delivery-expiry">{client.email}</p>
                </div>
                <span className="admin-client-count">{client.assetCount} files</span>
              </div>
              <div className="admin-client-meta">
                <span>{client.projectCount} project{client.projectCount === 1 ? '' : 's'}</span>
                <span>Updated {new Date(client.latestUpdatedAt).toLocaleDateString()}</span>
              </div>
              <div className="admin-client-preview">
                {client.assets.slice(0, 3).map((asset) => (
                  <span key={asset.id}>{asset.filename}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>
    )
  }

  const renderAdminClientDetail = () => {
    if (!session?.user.id || role !== 'admin') {
      return (
        <section className="portal-section admin-screen">
          <h2>Client folder</h2>
          <p className="portal-error">Only admin users can access this page.</p>
        </section>
      )
    }

    const client = selectedAdminClient

    if (!client) {
      return (
        <section className="portal-section admin-screen">
          <div className="portal-head admin-screen-head">
            <div>
              <p className="eyebrow">Client folder</p>
              <h2>No client selected</h2>
              <p>Pick a client from the folder list to view their uploads.</p>
            </div>
            <button className="button ghost" type="button" onClick={openAdminClients}>
              Back to folders
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className="portal-section admin-screen">
        <div className="portal-head admin-screen-head">
          <div>
            <p className="eyebrow">Client folder</p>
            <h2>{client.full_name}</h2>
            <p>
              {client.email}
              {client.phone ? ` · ${client.phone}` : ''}
            </p>
          </div>
          <div className="admin-head-actions">
            <button className="button ghost" type="button" onClick={openAdminClients}>
              Back
            </button>
            <button className="button ghost" type="button" onClick={() => openUploadForClient(client)}>
              Upload more
            </button>
            <button
              className="button ghost"
              type="button"
              onClick={() => setAdminClientEditMode((current) => !current)}
            >
              {adminClientEditMode ? 'Close edit' : 'Edit client'}
            </button>
            <button className="button ghost" type="button" onClick={() => void handleDeleteAdminClient()}>
              Delete client
            </button>
          </div>
        </div>

        <div className="admin-detail-summary">
          <div className="admin-stat-card">
            <span>Projects</span>
            <strong>{client.projectCount}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Files</span>
            <strong>{client.assetCount}</strong>
          </div>
          <div className="admin-stat-card">
            <span>Updated</span>
            <strong>{new Date(client.latestUpdatedAt).toLocaleDateString()}</strong>
          </div>
        </div>

        <div className="admin-detail-toolbar">
          <label className="admin-search">
            Search files
            <input
              type="search"
              value={adminAssetSearch}
              onChange={(event) => setAdminAssetSearch(event.target.value)}
              placeholder="Search by filename, type, or project"
            />
          </label>

          <label className="admin-search">
            Sort folders
            <select value={adminProjectSort} onChange={(event) => setAdminProjectSort(event.target.value as typeof adminProjectSort)}>
              <option value="recent">Recent activity</option>
              <option value="name">Name</option>
              <option value="files">File count</option>
            </select>
          </label>

          <div className="admin-detail-toolbar-copy">
            <p className="portal-hint">
              {selectedAdminAssetIds.length > 0
                ? `${selectedAdminAssetIds.length} selected file${selectedAdminAssetIds.length === 1 ? '' : 's'}`
                : `${selectedAdminVisibleAssets.length} visible file${selectedAdminVisibleAssets.length === 1 ? '' : 's'}`}
              {adminAssetSearch.trim() ? ` matching “${adminAssetSearch.trim()}”` : ''}
            </p>
            {client.notes && <p className="portal-hint">{client.notes}</p>}
          </div>
        </div>

        <div className="admin-bulk-actions">
          <button className="button ghost" type="button" onClick={selectVisibleAdminAssets}>
            Select visible
          </button>
          <button className="button ghost" type="button" onClick={clearSelectedAdminAssets}>
            Clear selection
          </button>
          {selectedAdminAssetIds.length > 0 && (
            <button className="button primary" type="button" onClick={() => void handleBulkDeleteAdminAssets()}>
              Delete selected
            </button>
          )}
        </div>

        {adminClientEditMode && (
          <div className="admin-client-form">
            <label>
              Full name
              <input
                type="text"
                value={adminClientDraft.fullName}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, fullName: event.target.value }))
                }
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={adminClientDraft.email}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label>
              Phone
              <input
                type="text"
                value={adminClientDraft.phone}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </label>
            <label>
              Notes
              <textarea
                rows={4}
                value={adminClientDraft.notes}
                onChange={(event) =>
                  setAdminClientDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </label>
            <div className="admin-form-actions">
              <button className="button primary" type="button" onClick={() => void handleSaveAdminClient()}>
                Save client
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => {
                  if (!selectedAdminClient) return
                  setAdminClientDraft({
                    fullName: selectedAdminClient.full_name,
                    email: selectedAdminClient.email,
                    phone: selectedAdminClient.phone ?? '',
                    notes: selectedAdminClient.notes ?? '',
                  })
                  setAdminClientEditMode(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="admin-project-stack">
          {selectedAdminClientProjectViews.length === 0 ? (
            <p className="portal-hint">
              {client.projects.length === 0
                ? 'No projects yet for this client.'
                : 'No files match the current search.'}
            </p>
          ) : (
            selectedAdminClientProjectViews.map(({ project, totalAssets, visibleAssets, latestActivityAt }) => (
              <article key={project.id} className="admin-project-card">
                <div className="delivery-header">
                  <div>
                    <p className="delivery-title">{project.name}</p>
                    <p className="delivery-expiry">
                      {project.status}
                      {project.shoot_date ? ` · ${project.shoot_date}` : ''}
                      {project.location ? ` · ${project.location}` : ''}
                    </p>
                  </div>
                  <div className="admin-project-actions">
                    <span className="admin-client-count">
                      {visibleAssets.length}/{totalAssets} files
                    </span>
                    <button className="button ghost" type="button" onClick={() => void handleDeleteAdminProject(project)}>
                      Delete folder
                    </button>
                  </div>
                </div>

                {visibleAssets.length === 0 ? (
                  <p className="portal-hint">No files in this project match the current search.</p>
                ) : (
                  <div className="admin-asset-grid">
                    {visibleAssets.map((asset) => {
                      const isEditing = adminAssetEditingId === asset.id
                      const isSelected = selectedAdminAssetIds.includes(asset.id)
                      const previewUrl = adminAssetPreviewUrls[asset.id]
                      const isImage = asset.mime_type.startsWith('image/')
                      return (
                        <article key={asset.id} className={`admin-asset-card ${isSelected ? 'is-selected' : ''}`}>
                          <button
                            className="admin-asset-select"
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => toggleSelectedAdminAsset(asset.id)}
                          >
                            <span className="admin-asset-checkbox">{isSelected ? '✓' : ''}</span>
                            <span className="sr-only">Select {asset.filename}</span>
                          </button>
                          <div className="admin-asset-thumb">
                            {isImage && previewUrl ? (
                              <img src={previewUrl} alt={asset.filename} loading="lazy" />
                            ) : (
                              <div className="admin-asset-thumb-fallback">
                                <span>{asset.mime_type.split('/')[0]?.slice(0, 1).toUpperCase() || 'F'}</span>
                              </div>
                            )}
                          </div>
                          <div className="admin-asset-main">
                            {isEditing ? (
                              <input
                                type="text"
                                value={adminAssetDraftName}
                                onChange={(event) => setAdminAssetDraftName(event.target.value)}
                                autoFocus
                              />
                              ) : (
                                <p className="admin-asset-name">{asset.filename}</p>
                              )}
                            <p className="delivery-expiry">
                              {formatBytes(asset.bytes)} · {asset.mime_type}
                            </p>
                          </div>
                          <div className="delivery-asset-actions">
                            <button
                              className="button ghost"
                              type="button"
                              onClick={() => {
                                void handleOpenAsset(asset.id, 'view')
                              }}
                            >
                              View
                            </button>
                            {isEditing ? (
                              <>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={() => {
                                    void handleRenameAdminAsset(asset.id, adminAssetDraftName)
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={() => {
                                    setAdminAssetEditingId('')
                                    setAdminAssetDraftName('')
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={() => {
                                    setAdminAssetEditingId(asset.id)
                                    setAdminAssetDraftName(asset.filename)
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  className="button ghost"
                                  type="button"
                                  onClick={() => {
                                    void handleDeleteAdminAsset(asset.id)
                                  }}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
                <p className="portal-hint admin-project-updated">Last activity {new Date(latestActivityAt).toLocaleString()}</p>
              </article>
            ))
          )}
        </div>
      </section>
    )
  }

  const renderShareView = () => (
    <section className="portal-section">
      <h2>Shared Gallery</h2>
      <p>View-only mode. Download is disabled for this link.</p>

      {shareBusy && <p className="portal-hint">Loading shared media...</p>}
      {shareMessage && <p className="portal-error">{shareMessage}</p>}

      {!shareBusy && !shareMessage && (
        <ul className="delivery-assets">
          {shareAssets.map((asset) => (
            <li key={asset.id}>
              <span>{asset.filename}</span>
              <span>{formatBytes(asset.bytes)}</span>
              <span>{asset.mime_type}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <a className="brand-mark" href="#home" aria-label="Go to top">
            <img
              src="/logo/IMG_3142.PNG"
              alt="Rajugari_Abbayi Photography logo"
              loading="lazy"
            />
          </a>
          <div>
            <a className="brand-title" href="#home">
              Rajugari_Abbayi_Photography
            </a>
            <a
              className="brand-subtitle"
              href={personalInstagramUrl}
              target="_blank"
              rel="noreferrer"
            >
              Vishnu Varma
            </a>
          </div>
        </div>

        <div className="topbar-right">
          <nav className="nav">
            {session && role === 'customer' && <a href="#my-pictures">My Pictures</a>}
            {session && role === 'admin' && <a href="#upload">Upload</a>}
            {session && role === 'admin' && <a href="#admin-clients">Clients</a>}
            {!(session && role === 'admin') && <a href="#work">Work</a>}
            {!(session && role === 'admin') && <a href="#about">About</a>}
            <a href="/book.html">Contact</a>
          </nav>

          <div className="auth-box">
            <button
              className="login-icon"
              type="button"
              aria-label="Open login menu"
              onClick={() => setAuthMenuOpen((open) => !open)}
            >
              <span aria-hidden>📷</span>
              <span className="login-label">{loginLabel}</span>
            </button>

            {authMenuOpen && (
              <div className="auth-menu">
                {!isSupabaseConfigured && (
                  <p className="auth-note">
                    Configure Supabase env vars to enable login.
                  </p>
                )}

                {session ? (
                  <>
                    <p className="auth-note">
                      Logged in as <strong>{session.user.email}</strong> ({role})
                    </p>
                    <button className="button ghost" type="button" onClick={() => void handleSignOut()}>
                      Logout
                    </button>
                  </>
                ) : (
                  <>
                    <form className="auth-form" onSubmit={handleSendOtp}>
                      <label>
                        Email
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(event) => setEmailInput(event.target.value)}
                          placeholder="name@email.com"
                          required
                        />
                      </label>
                      <button className="button primary" type="submit" disabled={authBusy}>
                        {authBusy ? 'Sending...' : 'Send Magic Link'}
                      </button>
                    </form>
                  </>
                )}

                {authMessage && <p className="auth-note">{authMessage}</p>}
              </div>
            )}
          </div>
        </div>
      </header>

      <main>
        {view === 'home' && renderHomeSections()}
        {view === 'my-pictures' && renderMyPictures()}
        {view === 'upload' && renderUpload()}
        {view === 'admin-clients' && renderAdminClients()}
        {view === 'admin-client' && renderAdminClientDetail()}
        {view === 'share' && renderShareView()}
      </main>

      <footer className="footer">
        <p>© 2026 Rajugari_Abbayi Photography. Crafted with intention.</p>
      </footer>
    </div>
  )
}

export default App
