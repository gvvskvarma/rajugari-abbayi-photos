import { useEffect } from 'react'

const BASE_TITLE = 'Rajugari Abbayi Photography'

/**
 * Sets document title and meta description per route.
 * Resets to defaults on unmount so stale meta doesn't linger.
 */
export function useDocumentMeta(page: string, description: string) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = page ? `${page} | ${BASE_TITLE}` : BASE_TITLE

    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const previousDescription = meta?.content ?? ''
    if (meta) meta.content = description

    return () => {
      document.title = previousTitle
      if (meta) meta.content = previousDescription
    }
  }, [page, description])
}
