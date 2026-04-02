import { useParams } from 'react-router-dom'

export function ShareViewPage() {
  const { token } = useParams<{ token: string }>()

  return (
    <section className="portal-section">
      <h2>Shared Gallery</h2>
      <p>Loading shared gallery for token: {token?.slice(0, 8)}...</p>
    </section>
  )
}
