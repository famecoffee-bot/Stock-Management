import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { expiryLevel, lotsOnShelf, type ExpiryLevel } from '../lib/expiry'
import { shopToday } from '../lib/sales'
import type { Batch, Item, StockLevel } from '../lib/types'
import { formatQty } from '../lib/units'
import { Badge, Empty, PageHeader } from '../components/ui'

// Phase 5: what will expire soon. Lots are made when perishable stock is received
// with an expiry date. See lib/expiry.ts for how we work out which lots are left.

export interface ExpiryRow {
  item: Item
  batch: Batch
  qtyLeft: number
  daysLeft: number
  level: ExpiryLevel
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/** Every lot still on the shelf at a branch, soonest expiry first, plus stock with unknown expiry. */
export function useExpiry(branchId: string | undefined) {
  const today = shopToday()
  const since = addDays(today, -60) // older lots are long gone, or already flagged
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', '==', branchId ?? '')], `exp-${branchId}`, !branchId)
  const batches = useCollection<Batch>(
    COL.batches,
    [where('branchId', '==', branchId ?? ''), where('expiryDate', '>=', since), orderBy('expiryDate')],
    `${branchId}-${since}`,
    !branchId,
  )
  return useMemo(() => {
    const byItem = new Map<string, Batch[]>()
    for (const b of batches.rows) byItem.set(b.itemId, [...(byItem.get(b.itemId) ?? []), b])
    const rows: ExpiryRow[] = []
    const unknown: { item: Item; qty: number }[] = []
    for (const item of items.rows) {
      if (!item.perishable) continue
      const qty = levels.rows.find((l) => l.itemId === item.id)?.qty ?? 0
      if (qty <= 0) continue
      const r = lotsOnShelf(qty, byItem.get(item.id) ?? [], today)
      for (const lot of r.lots) rows.push({ item, batch: lot.batch, qtyLeft: lot.qtyLeft, daysLeft: lot.daysLeft, level: expiryLevel(lot.daysLeft) })
      if (r.unknownQty > 0) unknown.push({ item, qty: r.unknownQty })
    }
    rows.sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name))
    return { rows, unknown, today, loading: items.loading || levels.loading || batches.loading, error: batches.error }
  }, [items.rows, levels.rows, batches.rows, items.loading, levels.loading, batches.loading, batches.error, today])
}

export const LEVEL_TEXT: Record<ExpiryLevel, { label: (d: number) => string; tone: 'red' | 'amber' | 'green' | 'stone' }> = {
  expired: { label: (d) => (d === -1 ? 'Expired yesterday' : `Expired ${-d} days ago`), tone: 'red' },
  today: { label: (d) => (d === 0 ? 'Expires today' : 'Expires tomorrow'), tone: 'red' },
  soon: { label: (d) => `${d} days left`, tone: 'amber' },
  ok: { label: (d) => `${d} days left`, tone: 'green' },
}

export function Expiry() {
  const me = useProfile()
  const { current } = useBranch()
  const ex = useExpiry(current?.id)
  if (!current) return <Empty>Choose a branch first.</Empty>
  const staff = canAtBranch(me, current.id, 'staff')
  const expired = ex.rows.filter((r) => r.level === 'expired')
  const useFirst = ex.rows.filter((r) => r.level === 'today' || r.level === 'soon')
  const later = ex.rows.filter((r) => r.level === 'ok')

  return (
    <>
      <PageHeader title={`Expiry · ${current.name}`} subtitle="Use the oldest first. What expires soonest is at the top." />
      <div className="card mb-4 text-sm text-stone-600">
        The app does not track which carton each drink used. It assumes the team <b>uses the oldest first</b>, so what is left on the shelf is the
        newest stock. If the list looks wrong, the older stock is still there: use it first, or record it as waste.
      </div>
      {ex.error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{ex.error}</div>}
      {ex.rows.length === 0 && ex.unknown.length === 0 && (
        <Empty>{ex.loading ? 'Loading…' : 'Nothing perishable in stock with an expiry date. Expiry dates are entered when you receive perishable items.'}</Empty>
      )}
      {expired.length > 0 && (
        <Section title="Expired: throw away and record as waste" rows={expired} action={staff ? <Link to="/stock/waste" className="btn">Record waste</Link> : null} />
      )}
      {useFirst.length > 0 && <Section title="Use these first" rows={useFirst} />}
      {later.length > 0 && <Section title="Later" rows={later} />}
      {ex.unknown.length > 0 && (
        <div className="card mt-4 text-sm">
          <div className="mb-1 font-semibold text-bean-900">Expiry date not known</div>
          <p className="mb-2 text-stone-500">More stock than the lots received with a date (for example, it came by transfer). Check these by hand.</p>
          <ul className="space-y-1">
            {ex.unknown.map((u) => (
              <li key={u.item.id} className="flex justify-between">
                <span>{u.item.name}</span>
                <span className="text-stone-600">{formatQty(u.qty, u.item.baseUnit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function Section({ title, rows, action }: { title: string; rows: ExpiryRow[]; action?: React.ReactNode }) {
  return (
    <div className="card mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-bean-900">{title}</h2>
        {action}
      </div>
      <ul className="divide-y divide-stone-100">
        {rows.map((r) => (
          <li key={r.batch.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className="font-medium">{r.item.name}</span>
              <span className="ml-2 text-xs text-stone-400">expires {r.batch.expiryDate}</span>
            </span>
            <span className="flex items-center gap-2">
              {formatQty(r.qtyLeft, r.item.baseUnit)}
              <Badge tone={LEVEL_TEXT[r.level].tone}>{LEVEL_TEXT[r.level].label(r.daysLeft)}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
