import { useAuth } from '../hooks/useAuth'
import { useParams } from 'react-router-dom'

export function AdminClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const { session, role } = useAuth()

  if (!session?.user.id || role !== 'admin') {
    return (
      <section className="portal-section admin-screen">
        <h2>Client folder</h2>
        <p className="portal-error">Only admin users can access this page.</p>
      </section>
    )
  }

  return (
    <section className="portal-section admin-screen">
      <h2>Client folder: {clientId}</h2>
      <p>Page is being migrated to the new router.</p>
    </section>
  )
}
