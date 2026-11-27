import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch, isAdmin } from '../lib/permissions'
import { isWarehouse, type Item, type StockLevel, type Transfer } from '../lib/types'
import { countDue } from '../lib/counts'
import { useRequests } from './Requests'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Badge, PageHeader } from '../components/ui'
import { stockRows } from './Stock'
import { useOpenOrders } from './PurchaseOrders'
import { LEVEL_TEXT, useExpiry } from './Expiry'
import { useCounts } from './Counts'
import { t } from '../lib/i18n'

export function Dashboard() {
  const me = useProfile()
  const settings = useSettings()
  const { current, branches } = useBranch()
  const id = current?.id ?? ''
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', '==', id)], id, !current)
  const incoming = useCollection<Transfer>(COL.transfers, [where('toBranchId', '==', id), where('status', '==', 'sent'), limit(20)], `in${id}`, !current)

  const openOrders = useOpenOrders(current?.id)
  const expiry = useExpiry(current?.id)
  const counts = useCounts(current?.id, 10)
  const requests = useRequests(current, 30)
  const warehouse = isWarehouse(current)
  const rows = useMemo(() => stockRows(items.rows, levels.rows), [items.rows, levels.rows])
  const low = rows.filter((r) => r.status !== 'ok')
  const value = rows.reduce((s, r) => s + r.valueUsd, 0)
  const canWork = !!current && canAtBranch(me, current.id, 'staff')
  const isManager = !!current && canAtBranch(me, current.id, 'manager')

  // Phase 5 alerts: worked out live from stock, lots and counts, so they are never out of date.
  const useSoon = expiry.rows.filter((r) => r.level !== 'ok')
  const negative = rows.filter((r) => r.qty < 0)
  const waiting = counts.rows.filter((c) => c.status === 'submitted')
  // Weekly and monthly counts, for branches and the main warehouse alike.
  const weekly = countDue('weekly', current?.lastCounts?.weekly?.toDate())
  const monthly = countDue('monthly', current?.lastCounts?.monthly?.toDate())
  const hasStock = levels.rows.length > 0
  const weeklyDue = hasStock && weekly.state !== 'ok'
  const monthlyDue = hasStock && monthly.state !== 'ok'
  // Daily orders: the warehouse sees orders to send; a branch sees what is on the way.
  const ordersWaiting = requests.rows.filter((r) => r.status === 'requested')
  const ordersOnTheWay = requests.rows.filter((r) => r.status === 'sent')
  const attention =
    useSoon.length + negative.length + (isManager ? waiting.length : 0) + (weeklyDue ? 1 : 0) + (monthlyDue ? 1 : 0) + (warehouse && canWork ? ordersWaiting.length : 0)

  const steps = [
    { done: branches.length > 0, text: t('Add your branches'), to: '/branches' },
    { done: items.rows.some((i) => i.active), text: t('Add the items you keep in stock'), to: '/items' },
    { done: levels.rows.length > 0, text: t('Receive your first stock'), to: '/stock/receive' },
  ]
  const setupDone = steps.every((s) => s.done)

  return (
    <>
      <PageHeader title={t('Hello, {name}', { name: me.name })} subtitle={current ? t('{name} at a glance', { name: current.name }) : t('Welcome to Grove Stock')} />
      {current && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label={t('Stock value')} value={formatUsd(value)} note={formatKhr(value, settings.usdToKhr)} />
          <Stat label={t('Low or out')} value={low.length} note={low.length ? t('Needs ordering') : t('All good')} />
          <Stat label={t('Use soon')} value={useSoon.length} note={useSoon.length ? t('Expired or expiring in 3 days') : t('Nothing expiring')} />
          {warehouse ? (
            <Stat label={t('Daily orders to send')} value={ordersWaiting.length} note={ordersWaiting.length ? t('Branches are waiting') : t('All sent')} />
          ) : (
            <Stat label={t('Transfers to confirm')} value={incoming.rows.length} note={ordersOnTheWay.length ? t('{n} daily orders on the way', { n: ordersOnTheWay.length }) : undefined} />
          )}
          <Stat label={t('Orders on the way')} value={openOrders.rows.length} note={t('Receive them on the Receive page')} />
        </div>
      )}
      {canWork && (
        <div className="mb-5 flex flex-wrap gap-2">
          <Link to="/stock/receive" className="btn">{t('Receive stock')}</Link>
          <Link to="/sales" className="btn-ghost">{t('Enter sales')}</Link>
          <Link to="/stock/waste" className="btn-ghost">{t('Record waste')}</Link>
          <Link to="/counts" className="btn-ghost">{t('Count stock')}</Link>
          <Link to={warehouse ? '/requests' : '/requests/new'} className="btn-ghost">{warehouse ? t('Daily orders') : t('Order from warehouse')}</Link>
          <Link to="/transfers" className="btn-ghost">{t('Transfers')}</Link>
          <Link to="/purchase-orders" className="btn-ghost">{t('Purchase orders')}</Link>
        </div>
      )}
      {current && attention > 0 && (
        <div className="card mb-5">
          <h2 className="mb-2 font-semibold text-bean-900">{t('Needs attention')}</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {warehouse &&
              canWork &&
              ordersWaiting.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>{t('Daily order {number} from {name} is waiting', { number: r.number, name: r.branchName })}</span>
                  <Link to="/requests" className="shrink-0 text-bean-700 hover:underline">{t('Check and send')}</Link>
                </li>
              ))}
            {isManager &&
              waiting.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <span>{t('Stock count by')}{' '}{c.submittedByName}{' '}{t('is waiting for your approval')}</span>
                  <Link to={`/counts/${c.id}`} className="text-bean-700 hover:underline">{t('Review')}</Link>
                </li>
              ))}
            {useSoon.slice(0, 6).map((r) => (
              <li key={r.batch.id} className="flex items-center justify-between py-2">
                <span>
                  {r.item.name} <span className="text-stone-400">· {formatQty(r.qtyLeft, r.item.baseUnit)}</span>
                </span>
                <Badge tone={LEVEL_TEXT[r.level].tone}>{LEVEL_TEXT[r.level].label(r.daysLeft)}</Badge>
              </li>
            ))}
            {useSoon.length > 6 && (
              <li className="py-2">
                <Link to="/expiry" className="text-bean-700 hover:underline">{t('See all')}{' '}{useSoon.length}{' '}{t('on the Expiry page')}</Link>
              </li>
            )}
            {negative.length > 0 && (
              <li className="flex items-center justify-between gap-2 py-2">
                <span>
                  {t('Below zero:')}{' '}{negative.map((r) => r.item.name).join(', ')}{t('. Stock was used that the app never saw arrive.')}
                </span>
                <Link to="/counts" className="shrink-0 text-bean-700 hover:underline">{t('Count them')}</Link>
              </li>
            )}
            {weeklyDue && (
              <li className="flex items-center justify-between py-2">
                <span>{weekly.state === 'never' ? t('No weekly count yet here.') : t('Weekly count is due: the last one was {days} days ago.', { days: weekly.days })}</span>
                <Link to="/counts" className="shrink-0 text-bean-700 hover:underline">{t('Start a count')}</Link>
              </li>
            )}
            {monthlyDue && (
              <li className="flex items-center justify-between py-2">
                <span>{monthly.state === 'never' ? t('No monthly count yet here.') : t('Monthly count is due for this month.')}</span>
                <Link to="/counts" className="shrink-0 text-bean-700 hover:underline">{t('Start a count')}</Link>
              </li>
            )}
          </ul>
        </div>
      )}
      {low.length > 0 && (
        <div className="card mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-bean-900">{t('Low or out of stock')}</h2>
            {current && canAtBranch(me, current.id, 'manager') && (
              <Link to="/purchase-orders/new" className="text-sm text-bean-700 hover:underline">{t('Write an order')}</Link>
            )}
          </div>
          <ul className="divide-y divide-stone-100">
            {low.slice(0, 10).map((r) => (
              <li key={r.item.id} className="flex items-center justify-between py-2 text-sm">
                <span>{r.item.name}</span>
                <span className="flex items-center gap-2">
                  {formatQty(r.qty, r.item.baseUnit)}
                  {r.status === 'out' ? <Badge tone="red">{t('Out')}</Badge> : <Badge tone="amber">{t('Low')}</Badge>}
                </span>
              </li>
            ))}
          </ul>
          {low.length > 10 && (
            <Link to="/stock" className="mt-2 block text-sm text-bean-700 hover:underline">
              {t('See all')}{' '}{low.length}
            </Link>
          )}
        </div>
      )}
      {!setupDone && isAdmin(me) && (
        <div className="card">
          <h2 className="mb-2 font-semibold text-bean-900">{t('Getting started')}</h2>
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
