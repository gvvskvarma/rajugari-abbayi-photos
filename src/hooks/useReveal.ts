import { useEffect, useRef } from 'react'

/**
 * Scroll-reveal animation hook.
 * Adds `.revealed` class when element enters the viewport.
 */
export function useReveal<T extends HTMLElement>(threshold = 0.1) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('revealed')
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('revealed')
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])
  return ref
}
