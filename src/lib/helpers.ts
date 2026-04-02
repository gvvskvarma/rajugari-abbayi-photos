import type { AppView } from '../types'

export const toFirstName = (value?: string) => {
  const cleaned = (value ?? '').trim()
  if (!cleaned) return ''
  const firstToken = cleaned.split(/[\s._-]+/)[0] ?? ''
  if (!firstToken) return ''
  return firstToken.charAt(0).toUpperCase() + firstToken.slice(1).toLowerCase()
}

export const ADMIN_ACTIVITY_LIMIT = 24
export const ADMIN_PROJECT_CHUNK_SIZE = 12

export const getAssetKind = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return 'images'
  if (mimeType.startsWith('video/')) return 'videos'
  return 'other'
}

export const readViewFromHash = (): AppView => {
  const hash = window.location.hash || '#home'
  if (hash.startsWith('#share/')) return 'share'
  if (hash === '#my-pictures') return 'my-pictures'
  if (hash === '#upload') return 'upload'
  if (hash.startsWith('#admin-clients/')) return 'admin-client'
  if (hash === '#admin-clients' || hash === '#admin-work') return 'admin-clients'
  return 'home'
}

export const readAdminClientIdFromHash = () => {
  const hash = window.location.hash || ''
  if (!hash.startsWith('#admin-clients/')) return ''
  return hash.replace('#admin-clients/', '').split('/')[0]?.trim() ?? ''
}

export const readShareTokenFromHash = () => {
  const hash = window.location.hash || ''
  if (!hash.startsWith('#share/')) return ''
  return hash.replace('#share/', '').trim()
}

export const daysRemainingText = (expiresAt: string | null) => {
  if (!expiresAt) return 'Not started'
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return 'Expired'
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return `Expires in ${days} day${days === 1 ? '' : 's'}`
}

export const randomToken = () => {
  const buffer = new Uint8Array(24)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}
