import { useEffect, useMemo, useState } from 'react'
import './App.css'

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

type RotatingGalleryProps = {
  title: string
  subtitle: string
  images: ResponsiveAsset[]
  cycleStep: number
}

const getPrimaryPreloadSource = (asset: ResponsiveAsset) =>
  asset.sources[0]?.src ?? ''

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

  useEffect(() => {
    const id = window.setInterval(() => {
      setCycleStep((current) => current + 1)
    }, 2000)
    return () => window.clearInterval(id)
  }, [])

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
            <a className="brand-title" href={instagramUrl} target="_blank" rel="noreferrer">
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
        <nav className="nav">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
          <a href="/book.html">Book</a>
        </nav>
      </header>

      <main>
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
              <a className="button ghost" href="#contact">
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
                Book a shoot
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
      </main>

      <footer className="footer">
        <p>© 2026 Rajugari_Abbayi Photography. Crafted with intention.</p>
      </footer>
    </div>
  )
}

export default App
