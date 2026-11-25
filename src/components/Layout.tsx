import { NavLink, Outlet } from 'react-router-dom'
import { logout, useProfile } from '../lib/auth'
import { isAdmin } from '../lib/permissions'
import { useBranch } from '../lib/branch'
import { isTrial } from '../lib/firebase'
import { LanguageSwitch, t } from '../lib/i18n'

const NAV = [
  { to: '/', label: t('Dashboard'), admin: false },
  { to: '/stock', label: t('Stock'), admin: false },
  { to: '/stock/receive', label: t('Receive'), admin: false },
  { to: '/sales', label: t('Sales'), admin: false },
  { to: '/counts', label: t('Counts'), admin: false },
  { to: '/expiry', label: t('Expiry'), admin: false },
  { to: '/purchase-orders', label: t('Orders'), admin: false },
  { to: '/transfers', label: t('Transfers'), admin: false },
  { to: '/history', label: t('History'), admin: false },
  { to: '/reports', label: t('Reports'), admin: false },
  { to: '/items', label: t('Items'), admin: false },
  { to: '/menu', label: t('Menu'), admin: false },
  { to: '/suppliers', label: t('Suppliers'), admin: false },
  { to: '/branches', label: t('Branches'), admin: false },
  { to: '/users', label: t('Users'), admin: true },
  { to: '/settings', label: t('Settings'), admin: true },
]

export function Layout() {
  const me = useProfile()
  const links = NAV.filter((n) => !n.admin || isAdmin(me))
  const { branches, current, setCurrent } = useBranch()

  return (
    <div className="min-h-screen">
      {isTrial && (
        <div className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950">
          {t('TEST VERSION · practice data only · not connected to grove-system-kh')}
        </div>
      )}
      <header className="bg-bean-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="whitespace-nowrap font-semibold tracking-wide">{t('Grove Stock')}</div>
            {branches.length > 0 && (
              <select
                className="max-w-[7rem] truncate rounded-md sm:max-w-[11rem] border border-white/30 bg-bean-900 px-2 py-1 text-sm text-white"
                value={current?.id ?? ''}
                onChange={(e) => setCurrent(e.target.value)}
                aria-label={t('Branch')}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm sm:gap-3">
            <LanguageSwitch dark />
            <span className="hidden text-bean-100 sm:inline">
              {me.name} · {t(me.role)}
            </span>
            <button className="whitespace-nowrap rounded-md border border-white/30 px-2 py-1 text-xs hover:bg-white/10" onClick={logout}>
              {t('Sign out')}
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
