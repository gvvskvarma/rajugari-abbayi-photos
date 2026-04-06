import { lazy, Suspense } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './App.css'
import { Layout } from './components/Layout.tsx'
import { LegacyRedirect } from './components/LegacyRedirect.tsx'

const HomePage = lazy(() => import('./pages/HomePage.tsx').then((m) => ({ default: m.HomePage })))
const BookPage = lazy(() => import('./pages/BookPage.tsx').then((m) => ({ default: m.BookPage })))
const MyPicturesPage = lazy(() => import('./pages/MyPicturesPage.tsx').then((m) => ({ default: m.MyPicturesPage })))
const UploadPage = lazy(() => import('./pages/UploadPage.tsx').then((m) => ({ default: m.UploadPage })))
const AdminClientsPage = lazy(() => import('./pages/AdminClientsPage.tsx').then((m) => ({ default: m.AdminClientsPage })))
const AdminClientDetailPage = lazy(() => import('./pages/AdminClientDetailPage.tsx').then((m) => ({ default: m.AdminClientDetailPage })))
const ShareViewPage = lazy(() => import('./pages/ShareViewPage.tsx').then((m) => ({ default: m.ShareViewPage })))
const AboutPage = lazy(() => import('./pages/AboutPage.tsx').then((m) => ({ default: m.AboutPage })))

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="portal-section"><p className="portal-hint">Loading...</p></div>}>{children}</Suspense>
}

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LazyPage><HomePage /></LazyPage> },
      { path: '/work', element: <LazyPage><HomePage sectionId="work" /></LazyPage> },
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
