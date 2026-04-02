export type ResponsiveAsset = {
  key: string
  sources: Array<{
    src: string
    srcSet?: string
  }>
}

export type ResponsiveImageProps = {
  asset: ResponsiveAsset
  alt: string
  className?: string
  sizes: string
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
}
