import { NavLink, Outlet } from 'react-router-dom'
import { logout, useProfile } from '../lib/auth'
import { isAdmin } from '../lib/permissions'
import { useBranch } from '../lib/branch'

const NAV = [
  { to: '/', label: 'Dashboard', admin: false },
  { to: '/stock', label: 'Stock', admin: false },
  { to: '/stock/receive', label: 'Receive', admin: false },
  { to: '/transfers', label: 'Transfers', admin: false },
  { to: '/history', label: 'History', admin: false },
  { to: '/items', label: 'Items', admin: false },
  { to: '/branches', label: 'Branches', admin: false },
  { to: '/users', label: 'Users', admin: true },
  { to: '/settings', label: 'Settings', admin: true },
]

export function Layout() {
  const me = useProfile()
  const links = NAV.filter((n) => !n.admin || isAdmin(me))
  const { branches, current, setCurrent } = useBranch()

  return (
    <div className="min-h-screen">
      <header className="bg-bean-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="font-semibold tracking-wide">Grove Stock</div>
            {branches.length > 0 && (
              <select
                className="max-w-[11rem] truncate rounded-md border border-white/30 bg-bean-900 px-2 py-1 text-sm text-white"
                value={current?.id ?? ''}
                onChange={(e) => setCurrent(e.target.value)}
                aria-label="Branch"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-bean-100 sm:inline">
              {me.name} · {me.role}
            </span>
            <button className="rounded-md border border-white/30 px-2 py-1 text-xs hover:bg-white/10" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {links.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/' || n.to === '/stock'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-white text-bean-900' : 'text-bean-100 hover:bg-white/10'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  )
}
