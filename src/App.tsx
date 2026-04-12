import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './App.css'
import { Layout } from './components/Layout.tsx'
import { AdminLayout } from './components/AdminLayout.tsx'
import { LegacyRedirect } from './components/LegacyRedirect.tsx'

/* Auto-reload on stale chunk (happens after a new deployment) */
function lazyRetry(factory: () => Promise<Record<string, unknown>>, name: string) {
  return lazy(() =>
    factory()
      .then((m) => {
        // Chunk loaded successfully — clear the retry flag so future
        // failures (e.g. navigating to another page after another deploy)
        // can also trigger a reload.
        sessionStorage.removeItem('chunk-retry')
        return { default: m[name] as React.ComponentType<Record<string, never>> }
      })
      .catch(() => {
        const key = 'chunk-retry'
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1')
          window.location.reload()
        }
        // After a failed retry, return null so React doesn't crash
        return { default: (() => null) as unknown as React.ComponentType<Record<string, never>> }
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
const LivePage = lazyRetry(() => import('./pages/LivePage.tsx'), 'LivePage')

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="portal-section"><p className="portal-hint">Loading...</p></div>}>{children}</Suspense>
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LazyPage><HomePage /></LazyPage> },
      { path: '/work', element: <LazyPage><PortfolioPage /></LazyPage> },
      { path: '/portfolio', element: <LazyPage><PortfolioPage /></LazyPage> },
      { path: '/about', element: <LazyPage><AboutPage /></LazyPage> },
      { path: '/live', element: <LazyPage><LivePage /></LazyPage> },
      { path: '/book', element: <LazyPage><BookPage /></LazyPage> },
      { path: '/my-pictures', element: <LazyPage><MyPicturesPage /></LazyPage> },
      {
        element: <AdminLayout />,
        children: [
          { path: '/upload', element: <LazyPage><UploadPage /></LazyPage> },
          { path: '/admin/clients', element: <LazyPage><AdminClientsPage /></LazyPage> },
          { path: '/admin/clients/:clientId', element: <LazyPage><AdminClientDetailPage /></LazyPage> },
        ],
      },
      { path: '/share/:token', element: <LazyPage><ShareViewPage /></LazyPage> },
      { path: '*', element: <LegacyRedirect /> },
    ],
  },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
