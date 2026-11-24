import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { isAdmin } from './lib/permissions'
import { Layout } from './components/Layout'
import { Login, NoProfile } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Branches } from './pages/Branches'
import { Items } from './pages/Items'
import { Users } from './pages/Users'
import { Settings } from './pages/Settings'

function Gate() {
  const s = useAuth()
  if (s.status === 'loading') return <div className="p-8 text-center text-sm text-stone-500">Loading…</div>
  if (s.status === 'signedOut') return <Login />
  if (s.status === 'noProfile') return <NoProfile />
  if (!s.profile.active) return <NoProfile />
  const admin = isAdmin(s.profile)
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="items" element={<Items />} />
        <Route path="branches" element={<Branches />} />
        {admin && <Route path="users" element={<Users />} />}
        {admin && <Route path="settings" element={<Settings />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  )
}
