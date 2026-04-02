import type { AdminActivityItem, AdminActivityKind } from '../types'

export type AdminActivityState = {
  activities: AdminActivityItem[]
  busy: boolean
  error: string
  kindFilter: 'all' | AdminActivityKind
  expanded: boolean
}

export type AdminActivityAction =
  | { type: 'SET_ACTIVITIES'; activities: AdminActivityItem[] }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'SET_KIND_FILTER'; filter: 'all' | AdminActivityKind }
  | { type: 'SET_EXPANDED'; expanded: boolean }
  | { type: 'TOGGLE_EXPANDED' }
  | { type: 'RESET' }

export function createAdminActivityInitialState(expanded: boolean): AdminActivityState {
  return {
    activities: [],
    busy: false,
    error: '',
    kindFilter: 'all',
    expanded,
  }
}

export function adminActivityReducer(state: AdminActivityState, action: AdminActivityAction): AdminActivityState {
  switch (action.type) {
    case 'SET_ACTIVITIES':
      return { ...state, activities: action.activities }
    case 'SET_BUSY':
      return { ...state, busy: action.busy }
    case 'SET_ERROR':
      return { ...state, error: action.error }
    case 'SET_KIND_FILTER':
      return { ...state, kindFilter: action.filter }
    case 'SET_EXPANDED':
      return { ...state, expanded: action.expanded }
    case 'TOGGLE_EXPANDED':
      return { ...state, expanded: !state.expanded }
    case 'RESET':
      return { ...state, activities: [], busy: false, error: '', kindFilter: 'all' }
  }
}
