import { Outlet } from 'react-router-dom'
import { AdminDataProvider } from '../context/AdminDataContext.tsx'

/**
 * Wraps admin-only routes with AdminDataProvider.
 * Non-admin pages no longer pay the cost of admin data fetching.
 */
export function AdminLayout() {
  return (
    <AdminDataProvider>
      <Outlet />
    </AdminDataProvider>
  )
}
