import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import './index.css'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import Chrome from './components/Chrome'
import AuthCallback from './pages/AuthCallback'
import Chat from './pages/Chat'
import PeopleList from './pages/PeopleList'
import PersonDetail from './pages/PersonDetail'
import PersonEdit from './pages/PersonEdit'
import SignIn from './pages/SignIn'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function Gate() {
  const { status } = useAuth()
  const location = useLocation()

  // The callback route must render before a session exists.
  if (location.pathname === '/auth/callback') {
    return (
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    )
  }

  if (status === 'checking') {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">…</div>
  }
  if (status === 'signed-out') return <SignIn />

  return (
    <Routes>
      <Route element={<Chrome />}>
        <Route path="/" element={<PeopleList />} />
        <Route path="/chat" element={<Chat />} />
      </Route>
      <Route path="/p/new" element={<PersonEdit />} />
      <Route path="/p/:id" element={<PersonDetail />} />
      <Route path="/p/:id/edit" element={<PersonEdit />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
