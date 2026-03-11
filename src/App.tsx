import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const instagramUrl =
  'https://www.instagram.com/rajugari_abbayi_photography?igsh=azYxaHdwYmdhaTh0&utm_source=qr'
const personalInstagramUrl =
  'https://www.instagram.com/rajugari_abbayi?igsh=MTB3MHk4ODZxODM5dg%3D%3D&utm_source=qr'

const mediaBaseUrl = (import.meta.env.VITE_MEDIA_BASE_URL ?? '').trim().replace(/\/+$/, '')

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
type AppView = 'home' | 'my-pictures' | 'upload' | 'share'

type DeliveryRecipient = {
  id: string
  delivery_id: string
  email: string
  access_mode: 'owner' | 'viewer'
  first_viewed_at: string | null
  expires_at: string | null
}

type DeliveryAsset = {
  id: string
  delivery_id: string
  filename: string
  mime_type: string
  bytes: number
  r2_object_key: string
  created_at: string
}

type DeliveryCard = {
  deliveryId: string
  expiresAt: string | null
  firstViewedAt: string | null
  assets: DeliveryAsset[]
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
  return 'home'
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
  const [session, setSession] = useState<{ user: { id: string; email?: string } } | null>(null)
  const [role, setRole] = useState<Role>('customer')

  const [view, setView] = useState<AppView>(readViewFromHash())
  const [shareToken, setShareToken] = useState(readShareTokenFromHash())

  const [myDeliveries, setMyDeliveries] = useState<DeliveryCard[]>([])
  const [customerError, setCustomerError] = useState('')
  const [customerBusy, setCustomerBusy] = useState(false)
  const [newShareLinks, setNewShareLinks] = useState<Record<string, string>>({})

  const [uploadEmail, setUploadEmail] = useState('')
  const [uploadTitle, setUploadTitle] = useState('Client Delivery')
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')

  const [shareAssets, setShareAssets] = useState<DeliveryAsset[]>([])
  const [shareBusy, setShareBusy] = useState(false)
  const [shareMessage, setShareMessage] = useState('')

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
        return
      }
      setSession({ user: { id: nextSession.user.id, email: nextSession.user.email ?? undefined } })
    }

    void boot()

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession?.user) {
        setSession(null)
        setRole('customer')
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
        .select('role')
        .eq('id', session.user.id)
        .single()

      if (!data) {
        setRole('customer')
        return
      }

      setRole(data.role === 'admin' ? 'admin' : 'customer')
    }

    void fetchRole()
  }, [session?.user.id])

  useEffect(() => {
    if (!supabase || view !== 'my-pictures' || !session?.user.email) return
    const client = supabase
    const normalizedEmail = session.user.email.toLowerCase()

    const loadCustomerData = async () => {
      setCustomerBusy(true)
      setCustomerError('')

      const recipientsResult = await client
        .from('delivery_recipients')
        .select('id, delivery_id, email, access_mode, first_viewed_at, expires_at')
        .eq('email', normalizedEmail)

      if (recipientsResult.error) {
        setCustomerError(recipientsResult.error.message)
        setCustomerBusy(false)
        return
      }

      const recipients = (recipientsResult.data ?? []) as DeliveryRecipient[]

      for (const recipient of recipients) {
        if (!recipient.first_viewed_at) {
          await client.rpc('activate_delivery_retention', { recipient_row_id: recipient.id })
        }
      }

      const refreshedRecipientsResult = await client
        .from('delivery_recipients')
        .select('id, delivery_id, email, access_mode, first_viewed_at, expires_at')
        .eq('email', normalizedEmail)

      const refreshedRecipients = (refreshedRecipientsResult.data ?? recipients) as DeliveryRecipient[]
      const activeRecipients = refreshedRecipients.filter((recipient) => {
        if (!recipient.expires_at) return true
        return new Date(recipient.expires_at).getTime() > Date.now()
      })

      const deliveryIds = activeRecipients.map((recipient) => recipient.delivery_id)
      if (deliveryIds.length === 0) {
        setMyDeliveries([])
        setCustomerBusy(false)
        return
      }

      const assetsResult = await client
        .from('assets')
        .select('id, delivery_id, filename, mime_type, bytes, r2_object_key, created_at')
        .in('delivery_id', deliveryIds)
        .order('created_at', { ascending: false })

      if (assetsResult.error) {
        setCustomerError(assetsResult.error.message)
        setCustomerBusy(false)
        return
      }

      const assets = (assetsResult.data ?? []) as DeliveryAsset[]
      const cards: DeliveryCard[] = activeRecipients.map((recipient) => ({
        deliveryId: recipient.delivery_id,
        expiresAt: recipient.expires_at,
        firstViewedAt: recipient.first_viewed_at,
        assets: assets.filter((asset) => asset.delivery_id === recipient.delivery_id),
      }))

      setMyDeliveries(cards)
      setCustomerBusy(false)
    }

    void loadCustomerData()
  }, [session?.user.email, view])

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
        emailRedirectTo: window.location.origin,
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

  const handleUploadFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    setUploadFiles(selected)
  }

  const handleCreateShareLink = async (deliveryId: string) => {
    if (!supabase || !session?.user.id) return

    const token = randomToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error } = await supabase.from('share_links').insert({
      token,
      owner_profile_id: session.user.id,
      delivery_id: deliveryId,
      access_mode: 'viewer',
      allow_download: false,
      expires_at: expiresAt,
    })

    if (error) {
      setCustomerError(error.message)
      return
    }

    const url = `${window.location.origin}/#share/${token}`
    setNewShareLinks((current) => ({ ...current, [deliveryId]: url }))
  }

  const handleUploadDelivery = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session?.user.id) return

    const targetEmail = uploadEmail.trim().toLowerCase()
    if (!targetEmail || uploadFiles.length === 0) {
      setUploadMessage('Enter client email and add at least one photo/video.')
      return
    }

    setUploadBusy(true)
    setUploadMessage('')

    let clientId = ''
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

    if (existingClient.data?.id) {
      clientId = existingClient.data.id
    } else {
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

    const assetRows = uploadFiles.map((file, index) => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      return {
        owner_user_id: session.user.id,
        project_id: insertedProject.data.id,
        delivery_id: insertedDelivery.data.id,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        bytes: Math.max(1, file.size),
        kind: file.type.startsWith('video') ? 'video' : 'photo',
        r2_object_key: `pending/${insertedDelivery.data.id}/${Date.now()}-${index}-${safeName}`,
      }
    })

    const insertedAssets = await supabase.from('assets').insert(assetRows)
    if (insertedAssets.error) {
      setUploadMessage(insertedAssets.error.message)
      setUploadBusy(false)
      return
    }

    setUploadMessage(
      `Delivery created for ${targetEmail}. Client link: ${window.location.origin}/#my-pictures`
    )
    setUploadFiles([])
    setUploadEmail('')
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
                  onClick={() => {
                    void handleCreateShareLink(delivery.deliveryId)
                  }}
                >
                  Create view-only link
                </button>
              </div>

              {newShareLinks[delivery.deliveryId] && (
                <p className="portal-share-link">{newShareLinks[delivery.deliveryId]}</p>
              )}

              <ul className="delivery-assets">
                {delivery.assets.map((asset) => (
                  <li key={asset.id}>
                    <span>{asset.filename}</span>
                    <span>{formatBytes(asset.bytes)}</span>
                    <span>{asset.mime_type}</span>
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
        <section className="portal-section">
          <h2>Upload</h2>
          <p>Login required.</p>
        </section>
      )
    }

    if (role !== 'admin') {
      return (
        <section className="portal-section">
          <h2>Upload</h2>
          <p className="portal-error">Only admin users can access uploads.</p>
        </section>
      )
    }

    return (
      <section className="portal-section">
        <h2>Upload</h2>
        <p>Attach media to a client email and generate delivery access.</p>

        <form className="upload-form" onSubmit={handleUploadDelivery}>
          <label>
            Client email
            <input
              type="email"
              value={uploadEmail}
              onChange={(event) => setUploadEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Delivery title
            <input
              type="text"
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              required
            />
          </label>
          <label>
            Photos / videos
            <input type="file" multiple accept="image/*,video/*" onChange={handleUploadFilesChange} />
          </label>
          <button className="button primary" type="submit" disabled={uploadBusy || uploadFiles.length === 0}>
            {uploadBusy ? 'Creating delivery...' : 'Create delivery link'}
          </button>
        </form>

        {uploadMessage && <p className="portal-hint">{uploadMessage}</p>}
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
            <a href="#work">Work</a>
            <a href="#about">About</a>
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
              <span className="login-label">LOGIN</span>
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
        {view === 'share' && renderShareView()}
      </main>

      <footer className="footer">
        <p>© 2026 Rajugari_Abbayi Photography. Crafted with intention.</p>
      </footer>
    </div>
  )
}

export default App
