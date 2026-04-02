import { useAuth } from '../hooks/useAuth'

export function MyPicturesPage() {
  const { session } = useAuth()

  if (!session?.user.email) {
    return (
      <section className="portal-section">
        <h2>My Pictures</h2>
        <p>Log in with your email OTP to view your photos and videos.</p>
      </section>
    )
  }

  return (
    <section className="portal-section">
      <h2>My Pictures</h2>
      <p>Page is being migrated to the new router.</p>
    </section>
  )
}
