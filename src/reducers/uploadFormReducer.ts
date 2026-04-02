import type { UploadItem } from '../types'

export type UploadFormState = {
  clientMode: 'create' | 'reuse'
  email: string
  reuseSearch: string
  title: string
  items: UploadItem[]
  dropActive: boolean
  busy: boolean
  message: string
}

export type UploadFormAction =
  | { type: 'SET_CLIENT_MODE'; mode: 'create' | 'reuse' }
  | { type: 'SET_EMAIL'; email: string }
  | { type: 'SET_REUSE_SEARCH'; search: string }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_ITEMS'; items: UploadItem[] }
  | { type: 'APPEND_ITEMS'; items: UploadItem[] }
  | { type: 'REMOVE_GROUP'; groupKey: string; groupItems: UploadItem[] }
  | { type: 'SET_DROP_ACTIVE'; active: boolean }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_MESSAGE'; message: string }
  | { type: 'RESET' }
  | { type: 'PREPARE_FOR_CLIENT'; email: string; title: string }

export const uploadFormInitialState: UploadFormState = {
  clientMode: 'create',
  email: '',
  reuseSearch: '',
  title: 'Client Delivery',
  items: [],
  dropActive: false,
  busy: false,
  message: '',
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
      return { ...state, items: [...state.items, ...action.items] }
    case 'REMOVE_GROUP': {
      const removeSet = new Set(action.groupItems.map((item) => `${item.path}::${item.file.size}::${item.file.lastModified}`))
      return { ...state, items: state.items.filter((item) => !removeSet.has(`${item.path}::${item.file.size}::${item.file.lastModified}`)) }
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
  }
}
