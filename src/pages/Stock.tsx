import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { setStockLevels } from '../lib/api'
import type { Item, StockLevel } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'

export interface Row {
  item: Item
  stock: StockLevel | undefined
  qty: number
  reorderPoint: number
  status: 'out' | 'low' | 'ok'
  valueUsd: number
}

/** Join every item in use with its stock at a branch (an item never received counts as 0). */
export function stockRows(items: Item[], levels: StockLevel[]): Row[] {
  const byItem = new Map(levels.map((s) => [s.itemId, s]))
  return items
    .filter((i) => i.active || (byItem.get(i.id)?.qty ?? 0) !== 0)
    .map((item) => {
      const stock = byItem.get(item.id)
      const qty = stock?.qty ?? 0
      const reorderPoint = stock?.reorderPoint ?? item.defaultReorderPoint ?? 0
      const status: Row['status'] = qty <= 0 ? 'out' : qty <= reorderPoint ? 'low' : 'ok'
      return { item, stock, qty, reorderPoint, status, valueUsd: Math.max(qty, 0) * (stock?.avgCostUsd ?? 0) }
    })
}

export function StockPage() {
  const me = useProfile()
  const settings = useSettings()
  const { current } = useBranch()
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, current ? [where('branchId', '==', current.id)] : [], current?.id ?? '', !current)
  const [search, setSearch] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)

  const rows = useMemo(() => stockRows(items.rows, levels.rows), [items.rows, levels.rows])
  const list = rows.filter(
    (r) => (!onlyLow || r.status !== 'ok') && (!search || r.item.name.toLowerCase().includes(search.trim().toLowerCase())),
  )
  const totalValue = rows.reduce((s, r) => s + r.valueUsd, 0)
  const lowCount = rows.filter((r) => r.status !== 'ok').length
  const isManager = !!current && canAtBranch(me, current.id, 'manager')
  const canWork = !!current && canAtBranch(me, current.id, 'staff')

  if (!current) return <Empty>You have no branch yet. Ask an owner to give you one.</Empty>

  return (
    <>
      <PageHeader
        title={`Stock at ${current.name}`}
        subtitle={`Value ${formatUsd(totalValue)} (${formatKhr(totalValue, settings.usdToKhr)}) · ${lowCount} low or out`}
        action={
          canWork && (
            <div className="flex gap-2">
              <Link to="/stock/receive" className="btn">Receive</Link>
              <Link to="/stock/waste" className="btn-ghost">Waste</Link>
            </div>
          )
        }
      />
      <ErrorNote message={levels.error ?? items.error} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Search item" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          Only low or out ({lowCount})
        </label>
      </div>
      {!items.loading && list.length === 0 ? (
        <Empty>{rows.length === 0 ? 'No items yet. Add items first.' : 'Nothing to show.'}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[600px]">
            <thead className="bg-stone-50">
              <tr>
                <th className="th">Item</th>
                <th className="th text-right">On hand</th>
                <th className="th text-right">Reorder at</th>
                <th className="th">Status</th>
                <th className="th text-right">Value</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.item.id}>
                  <td className="td">
                    <div className="font-medium">{r.item.name}</div>
                    <div className="text-xs text-stone-400">{r.item.category}</div>
                  </td>
                  <td className={`td text-right font-medium ${r.qty < 0 ? 'text-red-600' : ''}`}>
                    {formatQty(r.qty, r.item.baseUnit)}
                    <div className="text-xs font-normal text-stone-400">
                      ≈ {Math.round((r.qty / r.item.unitsPerPurchase) * 10) / 10} × {r.item.purchaseUnit}
                    </div>
                  </td>
                  <td className="td text-right text-stone-500">{formatQty(r.reorderPoint, r.item.baseUnit)}</td>
                  <td className="td">
                    {r.status === 'out' ? <Badge tone="red">Out</Badge> : r.status === 'low' ? <Badge tone="amber">Low</Badge> : <Badge tone="green">OK</Badge>}
                  </td>
                  <td className="td text-right">{formatUsd(r.valueUsd)}</td>
                  <td className="td text-right whitespace-nowrap">
                    <Link className="mr-3 text-sm text-bean-700 hover:underline" to={`/history?item=${r.item.id}`}>
                      History
                    </Link>
                    {isManager && (
                      <button className="text-sm text-bean-700 hover:underline" onClick={() => setEditing(r)}>
                        Levels
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <LevelsForm row={editing} branchId={current.id} onClose={() => setEditing(null)} />}
    </>
  )
}

function LevelsForm({ row, branchId, onClose }: { row: Row; branchId: string; onClose: () => void }) {
  const u = row.item.baseUnit
  const [reorder, setReorder] = useState(String(row.reorderPoint))
  const [par, setPar] = useState(String(row.stock?.parLevel ?? 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await setStockLevels({ branchId, itemId: row.item.id, reorderPoint: Number(reorder) || 0, parLevel: Number(par) || 0 })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={`${row.item.name}: stock levels`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <Field label={`Reorder when below (${u})`} hint="Below this the item shows as Low.">
          <input className="input" type="number" min="0" step="any" value={reorder} onChange={(e) => setReorder(e.target.value)} />
        </Field>
        <Field label={`Fill up to (${u})`} hint="The amount you like to have after an order. Used for order suggestions later.">
          <input className="input" type="number" min="0" step="any" value={par} onChange={(e) => setPar(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  )
}
