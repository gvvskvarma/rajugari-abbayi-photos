import { useAuth } from '../hooks/useAuth'

export function UploadPage() {
  const { session, role } = useAuth()

  if (!session?.user.id) {
    return (
      <section className="portal-section admin-screen">
        <h2>Upload</h2>
        <p>Login required.</p>
      </section>
    )
  }

  if (role !== 'admin') {
    return (
      <section className="portal-section admin-screen">
        <h2>Upload</h2>
        <p className="portal-error">Only admin users can access uploads.</p>
      </section>
    )
  }

  return (
    <section className="portal-section admin-screen">
      <h2>Upload</h2>
      <p>Page is being migrated to the new router.</p>
    </section>
  )
}
