import type { UploadItem } from '../types'
import { dedupeUploadItems, normalizeUploadItemPath } from '../lib/upload'

/**
 * Surface shown after a delivery uploads successfully — the admin reviews
 * this before clicking "Send notification email." Cleared on RESET or when
 * a new upload starts.
 */
export type LastDelivery = {
  deliveryId: string
  clientId: string
  clientEmail: string
  title: string
  fileCount: number
  /** ISO timestamp once the notification email is actually sent. */
  notifiedAt: string | null
  /** Set when send is in flight so the button can show a spinner. */
  notifying: boolean
  /** Error from the notify mutation, surfaced inline so the admin can retry. */
  notifyError: string | null
}

export type UploadFormState = {
  clientMode: 'create' | 'reuse'
  email: string
  reuseSearch: string
  title: string
  items: UploadItem[]
  dropActive: boolean
  busy: boolean
  message: string
  lastDelivery: LastDelivery | null
}

export type UploadFormAction =
  | { type: 'SET_CLIENT_MODE'; mode: 'create' | 'reuse' }
  | { type: 'SET_EMAIL'; email: string }
  | { type: 'SET_REUSE_SEARCH'; search: string }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_ITEMS'; items: UploadItem[] }
  | { type: 'APPEND_ITEMS'; items: UploadItem[] }
  | { type: 'REMOVE_GROUP'; groupKey: string }
  | { type: 'SET_DROP_ACTIVE'; active: boolean }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_MESSAGE'; message: string }
  | { type: 'RESET' }
  | { type: 'PREPARE_FOR_CLIENT'; email: string; title: string }
  | { type: 'SET_LAST_DELIVERY'; delivery: LastDelivery }
  | { type: 'CLEAR_LAST_DELIVERY' }
  | { type: 'NOTIFY_START' }
  | { type: 'NOTIFY_SUCCESS'; sentAt: string }
  | { type: 'NOTIFY_ERROR'; error: string }

export const uploadFormInitialState: UploadFormState = {
  clientMode: 'create',
  email: '',
  reuseSearch: '',
  title: 'Client Delivery',
  items: [],
  dropActive: false,
  busy: false,
  message: '',
  lastDelivery: null,
}

export function uploadFormReducer(state: UploadFormState, action: UploadFormAction): UploadFormState {
  switch (action.type) {
    case 'SET_CLIENT_MODE':
      return { ...state, clientMode: action.mode }
    case 'SET_EMAIL':
      return { ...state, email: action.email }
    case 'SET_REUSE_SEARCH':
      return { ...state, reuseSearch: action.search }
    case 'SET_TITLE':
      return { ...state, title: action.title }
    case 'SET_ITEMS':
      return { ...state, items: action.items }
    case 'APPEND_ITEMS':
      return { ...state, items: dedupeUploadItems([...state.items, ...action.items]) }
    case 'REMOVE_GROUP': {
      return {
        ...state,
        items: state.items.filter((item) => {
          const normalizedPath = normalizeUploadItemPath(item.path)
          const segments = normalizedPath.split('/').filter(Boolean)
          const key = segments.length > 1 ? `folder:${segments[0]}` : `file:${normalizedPath}`
          return key !== action.groupKey
        }),
      }
    }
    case 'SET_DROP_ACTIVE':
      return { ...state, dropActive: action.active }
    case 'SET_BUSY':
      return { ...state, busy: action.busy }
    case 'SET_MESSAGE':
      return { ...state, message: action.message }
    case 'RESET':
      return uploadFormInitialState
    case 'PREPARE_FOR_CLIENT':
      return { ...state, clientMode: 'reuse', email: action.email, title: action.title, reuseSearch: action.email }
    case 'SET_LAST_DELIVERY':
      /* After a successful upload we clear the form fields but stash the
         delivery summary so the page can render a success card with the
         "Send notification email" button. */
      return {
        ...state,
        items: [],
        title: 'Client Delivery',
        email: '',
        reuseSearch: '',
        busy: false,
        message: '',
        lastDelivery: action.delivery,
      }
    case 'CLEAR_LAST_DELIVERY':
      return { ...state, lastDelivery: null }
    case 'NOTIFY_START':
      if (!state.lastDelivery) return state
      return { ...state, lastDelivery: { ...state.lastDelivery, notifying: true, notifyError: null } }
    case 'NOTIFY_SUCCESS':
      if (!state.lastDelivery) return state
      return {
        ...state,
        lastDelivery: { ...state.lastDelivery, notifying: false, notifyError: null, notifiedAt: action.sentAt },
      }
    case 'NOTIFY_ERROR':
      if (!state.lastDelivery) return state
      return { ...state, lastDelivery: { ...state.lastDelivery, notifying: false, notifyError: action.error } }
  }
}
