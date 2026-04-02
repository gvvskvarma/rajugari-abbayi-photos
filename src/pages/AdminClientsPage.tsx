import { useAuth } from '../hooks/useAuth'

export function AdminClientsPage() {
  const { session, role } = useAuth()

  if (!session?.user.id || role !== 'admin') {
    return (
      <section className="portal-section admin-screen">
        <h2>Client folders</h2>
        <p className="portal-error">Only admin users can access this page.</p>
      </section>
    )
  }

  return (
    <section className="portal-section admin-screen">
      <h2>Client folders</h2>
      <p>Page is being migrated to the new router.</p>
    </section>
  )
}
