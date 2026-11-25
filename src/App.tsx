import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, logout, useAuth } from './lib/auth'
import { isAdmin } from './lib/permissions'
import { Layout } from './components/Layout'
import { Login, NoProfile } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Branches } from './pages/Branches'
import { Items } from './pages/Items'
import { Users } from './pages/Users'
import { Settings } from './pages/Settings'
import { BranchProvider } from './lib/branch'
import { StockPage } from './pages/Stock'
import { StockChange } from './pages/StockChange'
import { Transfers } from './pages/Transfers'
import { History } from './pages/History'
import { Suppliers } from './pages/Suppliers'
import { Products } from './pages/Products'
import { Sales } from './pages/Sales'
import { CountSheet, Counts } from './pages/Counts'
import { Expiry } from './pages/Expiry'
import { Reports } from './pages/Reports'
import { PurchaseOrderEdit, PurchaseOrderView, PurchaseOrders } from './pages/PurchaseOrders'

function Gate() {
  const s = useAuth()
  if (s.status === 'loading') return <div className="p-8 text-center text-sm text-stone-500">Loading…</div>
  if (s.status === 'signedOut') return <Login />
  if (s.status === 'noProfile') return <NoProfile />
  if (!s.profile.active)
    return (
      <div className="p-8 text-center text-sm text-stone-600">
        Your access to the stock app is switched off. Ask an owner.{' '}
        <button className="underline" onClick={logout}>Sign out</button>
      </div>
    )
  const admin = isAdmin(s.profile)
  return (
    <BranchProvider>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="stock/receive" element={<StockChange key="receive" type="receive" />} />
        <Route path="stock/waste" element={<StockChange key="waste" type="waste" />} />
        <Route path="stock/adjust" element={<StockChange key="adjust" type="adjust" />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="history" element={<History />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="menu" element={<Products />} />
        <Route path="sales" element={<Sales />} />
        <Route path="counts" element={<Counts />} />
        <Route path="counts/:id" element={<CountSheet />} />
        <Route path="expiry" element={<Expiry />} />
        <Route path="reports" element={<Reports />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="purchase-orders/new" element={<PurchaseOrderEdit />} />
        <Route path="purchase-orders/:id" element={<PurchaseOrderView />} />
        <Route path="purchase-orders/:id/edit" element={<PurchaseOrderEdit />} />
        <Route path="items" element={<Items />} />
        <Route path="branches" element={<Branches />} />
        {admin && <Route path="users" element={<Users />} />}
        {admin && <Route path="settings" element={<Settings />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </BranchProvider>
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
