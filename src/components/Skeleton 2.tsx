/**
 * Reusable skeleton loading primitives.
 *
 * Variants:
 *  - text    -- single-line shimmer (configurable width)
 *  - card    -- rectangular card placeholder
 *  - thumbnail -- square thumbnail placeholder
 *
 * Composite helpers:
 *  - SkeletonGrid     -- N thumbnail skeletons in a grid (asset grids)
 *  - SkeletonCardList -- N card skeletons in a stack (delivery / client lists)
 */

interface SkeletonProps {
  variant?: 'text' | 'card' | 'thumbnail'
  /** CSS width value, mainly useful for the `text` variant. */
  width?: string
}

export function Skeleton({ variant = 'text', width }: SkeletonProps) {
  const className = `skeleton skeleton-${variant}`
  return <div className={className} style={width ? { width } : undefined} />
}

interface SkeletonGridProps {
  /** Number of thumbnail placeholders to render. Defaults to 8. */
  count?: number
}

export function SkeletonGrid({ count = 8 }: SkeletonGridProps) {
  return (
    <div className="skeleton-grid">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} variant="thumbnail" />
      ))}
    </div>
  )
}

interface SkeletonCardListProps {
  /** Number of card placeholders to render. Defaults to 3. */
  count?: number
}

export function SkeletonCardList({ count = 3 }: SkeletonCardListProps) {
  return (
    <div className="skeleton-card-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card-wrapper">
          <Skeleton variant="card" />
          <div className="skeleton-card-lines">
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
          </div>
        </div>
      ))}
    </div>
  )
}
