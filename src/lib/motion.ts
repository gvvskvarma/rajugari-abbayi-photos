/**
 * Shared Framer Motion variants and helpers.
 *
 * All animations:
 *   - Use only `transform` (x, y, scale) and `opacity` so they composite on
 *     the GPU and stay 60fps on mobile
 *   - Are short (200-500ms) — anything longer feels sluggish
 *   - Are gated by `prefers-reduced-motion` at the call site via Framer's
 *     `useReducedMotion()` hook
 *
 * Pattern: scope motion to public, content-leaning pages (`/`, `/work`,
 * `/about`, `/live`). Don't add motion to admin / upload / share / my-pictures
 * pages — they're tools, and motion there reads as friction.
 */

import type { Variants, Transition } from 'framer-motion'

/* ── Page transitions ────────────────────────────────────────────────
   Used in Layout to wrap the public-page Outlet. Subtle fade + 8px Y
   shift; runs in/out on route change so navigation feels intentional. */

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export const pageTransitionDuration: Transition = {
  duration: 0.25,
  ease: 'easeOut',
}

/* ── Stagger container + items ──────────────────────────────────────
   Used on the homepage hero — content elements fade up one after the
   other on landing. Delay before the first child so the page transition
   completes first. */

export const staggerContainer: Variants = {
  initial: { opacity: 1 }, // container is visible; children handle their own fade
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
}

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
}

/* ── Card hover ──────────────────────────────────────────────────────
   Used on portfolio thumbs in /work. A small scale + lift on hover, a
   slight press on tap. Spring transition feels physical without being
   bouncy. */

export const cardHover = {
  rest: { scale: 1, y: 0 },
  hover: { scale: 1.02, y: -4 },
  tap: { scale: 0.98 },
}

export const cardHoverTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 24,
  mass: 0.6,
}

/* ── Lightbox open/close ─────────────────────────────────────────────
   The shared layoutId pattern — see PortfolioPage for the matching
   thumbnail layoutId. Framer interpolates between the two automatically
   when the lightbox mounts/unmounts. */

export const lightboxBackdrop: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
}

export const lightboxLayoutTransition: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 32,
  mass: 0.8,
}
