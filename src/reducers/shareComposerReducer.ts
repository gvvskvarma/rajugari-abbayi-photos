import type { ShareLinkScope } from '../types'

export type ShareComposerState = {
  deliveryId: string
  scope: ShareLinkScope
  selectedAssetIds: string[]
  busy: boolean
  message: string
}

export type ShareComposerAction =
  | { type: 'OPEN'; deliveryId: string }
  | { type: 'CLOSE' }
  | { type: 'SET_SCOPE'; scope: ShareLinkScope }
  | { type: 'TOGGLE_ASSET'; assetId: string }
  | { type: 'SELECT_ALL'; assetIds: string[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_MESSAGE'; message: string }

export const shareComposerInitialState: ShareComposerState = {
  deliveryId: '',
  scope: 'all',
  selectedAssetIds: [],
  busy: false,
  message: '',
}

export function shareComposerReducer(state: ShareComposerState, action: ShareComposerAction): ShareComposerState {
  switch (action.type) {
    case 'OPEN':
      return { ...shareComposerInitialState, deliveryId: action.deliveryId }
    case 'CLOSE':
      return shareComposerInitialState
    case 'SET_SCOPE':
      return { ...state, scope: action.scope }
    case 'TOGGLE_ASSET':
      return {
        ...state,
        selectedAssetIds: state.selectedAssetIds.includes(action.assetId)
          ? state.selectedAssetIds.filter((id) => id !== action.assetId)
          : [...state.selectedAssetIds, action.assetId],
      }
    case 'SELECT_ALL':
      return { ...state, selectedAssetIds: action.assetIds }
    case 'CLEAR_SELECTION':
      return { ...state, selectedAssetIds: [] }
    case 'SET_BUSY':
      return { ...state, busy: action.busy }
    case 'SET_MESSAGE':
      return { ...state, message: action.message }
  }
}
