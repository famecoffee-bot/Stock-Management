import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch, isAdmin } from '../lib/permissions'
import type { Item, StockLevel, Transfer } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Badge, PageHeader } from '../components/ui'
import { stockRows } from './Stock'
import { useOpenOrders } from './PurchaseOrders'

export function Dashboard() {
  const me = useProfile()
  const settings = useSettings()
  const { current, branches } = useBranch()
  const id = current?.id ?? ''
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', '==', id)], id, !current)
  const incoming = useCollection<Transfer>(COL.transfers, [where('toBranchId', '==', id), where('status', '==', 'sent'), limit(20)], `in${id}`, !current)

  const openOrders = useOpenOrders(current?.id)
  const rows = useMemo(() => stockRows(items.rows, levels.rows), [items.rows, levels.rows])
  const low = rows.filter((r) => r.status !== 'ok')
  const value = rows.reduce((s, r) => s + r.valueUsd, 0)
  const canWork = !!current && canAtBranch(me, current.id, 'staff')

  const steps = [
    { done: branches.length > 0, text: 'Add your branches', to: '/branches' },
    { done: items.rows.some((i) => i.active), text: 'Add the items you keep in stock', to: '/items' },
    { done: levels.rows.length > 0, text: 'Receive your first stock', to: '/stock/receive' },
  ]
  const setupDone = steps.every((s) => s.done)

  return (
    <>
      <PageHeader title={`Hello, ${me.name}`} subtitle={current ? `${current.name} at a glance` : 'Welcome to Grove Stock'} />
      {current && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Stock value" value={formatUsd(value)} note={formatKhr(value, settings.usdToKhr)} />
          <Stat label="Low or out" value={low.length} note={low.length ? 'Needs ordering' : 'All good'} />
          <Stat label="Transfers to confirm" value={incoming.rows.length} />
          <Stat label="Orders on the way" value={openOrders.rows.length} note="Receive them on the Receive page" />
        </div>
      )}
      {canWork && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Link to="/stock/receive" className="btn">Receive stock</Link>
          <Link to="/stock/waste" className="btn-ghost">Record waste</Link>
          <Link to="/transfers" className="btn-ghost">Transfers</Link>
          <Link to="/purchase-orders" className="btn-ghost">Purchase orders</Link>
        </div>
      )}
      {low.length > 0 && (
        <div className="card mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-bean-900">Low or out of stock</h2>
            {current && canAtBranch(me, current.id, 'manager') && (
              <Link to="/purchase-orders/new" className="text-sm text-bean-700 hover:underline">Write an order</Link>
            )}
          </div>
          <ul className="divide-y divide-stone-100">
            {low.slice(0, 10).map((r) => (
              <li key={r.item.id} className="flex items-center justify-between py-2 text-sm">
                <span>{r.item.name}</span>
                <span className="flex items-center gap-2">
                  {formatQty(r.qty, r.item.baseUnit)}
                  {r.status === 'out' ? <Badge tone="red">Out</Badge> : <Badge tone="amber">Low</Badge>}
                </span>
              </li>
            ))}
          </ul>
          {low.length > 10 && (
            <Link to="/stock" className="mt-2 block text-sm text-bean-700 hover:underline">
              See all {low.length}
            </Link>
          )}
        </div>
      )}
      {!setupDone && isAdmin(me) && (
        <div className="card">
          <h2 className="mb-2 font-semibold text-bean-900">Getting started</h2>
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={s.text} className="flex items-center gap-2 text-sm">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${s.done ? 'bg-green-600 text-white' : 'bg-stone-200'}`}>
                  {s.done ? '✓' : i + 1}
                </span>
                <Link to={s.to} className="hover:underline">
                  {s.text}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  )
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-2xl font-semibold text-bean-900">{value}</div>
      {note && <div className="text-xs text-stone-400">{note}</div>}
    </div>
  )
}
