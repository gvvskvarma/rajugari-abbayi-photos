import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function LegacyRedirect() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const path = location.pathname

    if (path === '/home' || path === '/home/') {
      void navigate('/', { replace: true })
      return
    }
    if (path.startsWith('/share/')) {
      void navigate(path, { replace: true })
      return
    }
    if (path.startsWith('/admin-clients/')) {
      const clientId = path.replace('/admin-clients/', '').split('/')[0]?.trim()
      if (clientId) {
        void navigate(`/admin/clients/${clientId}`, { replace: true })
        return
      }
    }
    if (path === '/admin-clients' || path === '/admin-work') {
      void navigate('/admin/clients', { replace: true })
      return
    }

    void navigate('/', { replace: true })
  }, [location.pathname, navigate])

  return null
}
