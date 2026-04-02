import { createHashRouter, RouterProvider } from 'react-router-dom'
import './App.css'
import { Layout } from './components/Layout.tsx'
import { LegacyRedirect } from './components/LegacyRedirect.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { BookPage } from './pages/BookPage.tsx'
import { MyPicturesPage } from './pages/MyPicturesPage.tsx'
import { UploadPage } from './pages/UploadPage.tsx'
import { AdminClientsPage } from './pages/AdminClientsPage.tsx'
import { AdminClientDetailPage } from './pages/AdminClientDetailPage.tsx'
import { ShareViewPage } from './pages/ShareViewPage.tsx'

const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/work', element: <HomePage sectionId="work" /> },
      { path: '/about', element: <HomePage sectionId="about" /> },
      { path: '/book', element: <BookPage /> },
      { path: '/my-pictures', element: <MyPicturesPage /> },
      { path: '/upload', element: <UploadPage /> },
      { path: '/admin/clients', element: <AdminClientsPage /> },
      { path: '/admin/clients/:clientId', element: <AdminClientDetailPage /> },
      { path: '/share/:token', element: <ShareViewPage /> },
      { path: '*', element: <LegacyRedirect /> },
    ],
  },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
