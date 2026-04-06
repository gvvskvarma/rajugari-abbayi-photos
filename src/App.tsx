import { lazy, Suspense } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './App.css'
import { Layout } from './components/Layout.tsx'
import { LegacyRedirect } from './components/LegacyRedirect.tsx'

/* Auto-reload on stale chunk (happens after a new deployment) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyRetry(factory: () => Promise<any>, name: string) {
  return lazy(() =>
    factory()
      .then((m: Record<string, unknown>) => ({ default: m[name] as React.ComponentType<any> }))
      .catch(() => {
        const key = 'chunk-retry'
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1')
          window.location.reload()
        }
        return { default: (() => null) as React.ComponentType<any> }
      }),
  )
}

const HomePage = lazyRetry(() => import('./pages/HomePage.tsx'), 'HomePage')
const BookPage = lazyRetry(() => import('./pages/BookPage.tsx'), 'BookPage')
const MyPicturesPage = lazyRetry(() => import('./pages/MyPicturesPage.tsx'), 'MyPicturesPage')
const UploadPage = lazyRetry(() => import('./pages/UploadPage.tsx'), 'UploadPage')
const AdminClientsPage = lazyRetry(() => import('./pages/AdminClientsPage.tsx'), 'AdminClientsPage')
const AdminClientDetailPage = lazyRetry(() => import('./pages/AdminClientDetailPage.tsx'), 'AdminClientDetailPage')
const ShareViewPage = lazyRetry(() => import('./pages/ShareViewPage.tsx'), 'ShareViewPage')
const AboutPage = lazyRetry(() => import('./pages/AboutPage.tsx'), 'AboutPage')
const PortfolioPage = lazyRetry(() => import('./pages/PortfolioPage.tsx'), 'PortfolioPage')

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="portal-section"><p className="portal-hint">Loading...</p></div>}>{children}</Suspense>
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LazyPage><HomePage /></LazyPage> },
      { path: '/work', element: <LazyPage><PortfolioPage /></LazyPage> },
      { path: '/portfolio', element: <LazyPage><PortfolioPage /></LazyPage> },
      { path: '/about', element: <LazyPage><AboutPage /></LazyPage> },
      { path: '/book', element: <LazyPage><BookPage /></LazyPage> },
      { path: '/my-pictures', element: <LazyPage><MyPicturesPage /></LazyPage> },
      { path: '/upload', element: <LazyPage><UploadPage /></LazyPage> },
      { path: '/admin/clients', element: <LazyPage><AdminClientsPage /></LazyPage> },
      { path: '/admin/clients/:clientId', element: <LazyPage><AdminClientDetailPage /></LazyPage> },
      { path: '/share/:token', element: <LazyPage><ShareViewPage /></LazyPage> },
      { path: '*', element: <LegacyRedirect /> },
    ],
  },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
