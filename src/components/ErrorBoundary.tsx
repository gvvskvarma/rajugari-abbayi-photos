import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: "'Manrope', system-ui, sans-serif",
          color: '#ece8df',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
        <p style={{ color: 'rgba(236, 232, 223, 0.7)', marginBottom: '1.5rem', maxWidth: '28rem' }}>
          An unexpected error occurred. Please reload the page to try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '0.625rem 1.5rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            color: '#0d0f15',
            background: 'linear-gradient(135deg, #d1b07f, #c8a879)',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Reload page
        </button>
      </div>
    )
  }
}
