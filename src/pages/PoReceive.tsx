import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { orderBy } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useDocument, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { canAtBranch } from '../lib/permissions'
import { receivePurchaseOrder } from '../lib/api'
import { isOpen, remainingPacks } from '../lib/purchasing'
import type { Item, PurchaseOrder } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Empty, ErrorNote, friendlyError } from '../components/ui'
import { StatusBadge, useOpenOrders } from './PurchaseOrders'
import { t } from '../lib/i18n'

// Receiving against a purchase order. This is part of the Receive screen:
// staff pick the order that arrived, the lines are already filled in with what
// is still expected, and they only change what is different.

/** Card on the Receive screen: "Deliveries we are waiting for". */
export function OpenOrdersCard({ branchId }: { branchId: string }) {
  const { rows } = useOpenOrders(branchId)
  if (rows.length === 0) return null
  return (
    <div className="card mb-4">
      <h2 className="mb-1 font-semibold text-bean-900">{t('Waiting for a delivery?')}</h2>
      <p className="mb-2 text-sm text-stone-500">{t('If the goods belong to an order, receive them from the order. Prices and quantities are filled in for you.')}</p>
      <ul className="divide-y divide-stone-100">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <b>{p.number}</b> · {p.supplierName}
              {p.expectedDate && <span className="text-stone-400">{' '}{t('· needed by')}{' '}{p.expectedDate}</span>} <StatusBadge po={p} />
            </span>
            <Link className="btn" to={`/stock/receive?po=${p.id}`}>{t('Receive this order')}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface Got {
  packs: string
  packCostUsd: string
  expiryDate: string
}

export function PoReceive({ id }: { id: string }) {
  const { row: po, loading } = useDocument<PurchaseOrder>(COL.purchaseOrders, id)
  if (loading) return <div className="p-6 text-sm text-stone-500">{t('Loading order…')}</div>
  if (!po) return <Empty>{t('Order not found.')}{' '}<Link className="underline" to="/stock/receive">{t('Back to Receive')}</Link></Empty>
  return <PoReceiveRounds po={po} />
}

/** After a save the order updates live; keep the "saved" message until staff ask to receive more. */
function PoReceiveRounds({ po }: { po: PurchaseOrder }) {
  const [round, setRound] = useState(0)
  const [done, setDone] = useState<string | null>(null)
  if (done) {
    return (
      <div className="card space-y-3 text-sm">
        <div className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{done}</div>
        <div className="flex flex-wrap gap-3">
          <Link className="btn" to={`/purchase-orders/${po.id}`}>{t('See the order')}</Link>
          <Link className="btn-ghost" to="/stock">{t('See stock')}</Link>
          {isOpen(po.status) && (
            <button className="btn-ghost" onClick={() => { setDone(null); setRound((r) => r + 1) }}>{t('Receive more for this order')}</button>
          )}
        </div>
      </div>
    )
  }
  return <PoReceiveForm key={round} po={po} onDone={setDone} />
}

function PoReceiveForm({ po, onDone }: { po: PurchaseOrder; onDone: (msg: string) => void }) {
  const me = useProfile()
  const settings = useSettings()
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const itemById = useMemo(() => new Map(items.rows.map((i) => [i.id, i])), [items.rows])
  const waiting = po.lines.filter((l) => remainingPacks(l) > 0)
  const [got, setGot] = useState<Record<string, Got>>(() =>
    Object.fromEntries(waiting.map((l) => [l.itemId, { packs: String(remainingPacks(l)), packCostUsd: String(l.packCostUsd), expiryDate: '' }])),
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canAtBranch(me, po.branchId, 'staff')) return <Empty>{t('You need staff rights at')}{' '}{po.branchName}{' '}{t('to receive.')}</Empty>
  if (!isOpen(po.status)) {
    return (
      <div className="card space-y-2 text-sm">
        <p>{po.number}{' '}{t('is')}{' '}{po.status}{t(': nothing more to receive.')}</p>
        <Link className="btn" to={`/purchase-orders/${po.id}`}>{t('See the order')}</Link>
      </div>
    )
  }

  const set = (itemId: string, patch: Partial<Got>) => setGot((g) => ({ ...g, [itemId]: { ...g[itemId], ...patch } }))
  const total = waiting.reduce((s, l) => s + (Number(got[l.itemId]?.packs) || 0) * (Number(got[l.itemId]?.packCostUsd) || 0), 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const lines = []
    for (const l of waiting) {
      const g = got[l.itemId]
      const packs = Number(g.packs)
      if (g.packs.trim() === '' || !(packs >= 0)) return setError(t('{itemName}: enter how many arrived (0 if none).', { itemName: l.itemName }))
      if (packs === 0) continue
      const cost = Number(g.packCostUsd)
      if (g.packCostUsd.trim() === '' || !(cost >= 0)) return setError(t('{itemName}: enter the price on the invoice.', { itemName: l.itemName }))
      if (itemById.get(l.itemId)?.perishable && !g.expiryDate) return setError(t('{itemName}: enter the expiry date.', { itemName: l.itemName }))
      lines.push({ itemId: l.itemId, packs, packCostUsd: cost, ...(g.expiryDate ? { expiryDate: g.expiryDate } : {}) })
    }
    if (lines.length === 0) return setError(t('Nothing arrived? Enter at least one quantity.'))
    setBusy(true)
    try {
      const r = await receivePurchaseOrder({ id: po.id, lines, note })
      onDone(
        r.status === 'received'
          ? t('{number} is fully received. Stock is updated.', { number: po.number })
          : t('Saved. Stock is updated; the rest of {number} is still expected.', { number: po.number }),
      )
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="card flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          {t('Receiving')}{' '}<b>{po.number}</b>{' '}{t('from')}{' '}<b>{po.supplierName}</b> <StatusBadge po={po} />
        </span>
        <Link className="text-bean-700 underline" to="/stock/receive">{t('Receive without an order')}</Link>
      </div>
      <ErrorNote message={error} />
      {waiting.map((l) => {
        const g = got[l.itemId]
        const item = itemById.get(l.itemId)
        const left = remainingPacks(l)
        const changed = Number(g.packCostUsd) !== l.packCostUsd
        return (
          <div key={l.itemId} className="card space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{l.itemName}</span>
              <span className="text-xs text-stone-500">
                {t('Ordered')}{' '}{l.packs} {l.purchaseUnit}
                {l.receivedPacks > 0 && t(', {receivedPacks} came already', { receivedPacks: l.receivedPacks })} · {left}{' '}{t('expected now')}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="label">{t('Arrived ({unit})', { unit: l.purchaseUnit })}</span>
                <input className="input" type="number" min="0" step="any" value={g.packs} onChange={(e) => set(l.itemId, { packs: e.target.value })} />
                <span className="mt-1 block text-xs text-stone-400">= {formatQty((Number(g.packs) || 0) * l.unitsPerPurchase, l.baseUnit)}</span>
              </label>
              <label className="block">
                <span className="label">{t('Price each on invoice (USD)')}</span>
                <input className="input" type="number" min="0" step="0.01" value={g.packCostUsd} onChange={(e) => set(l.itemId, { packCostUsd: e.target.value })} />
                {changed && <span className="mt-1 block text-xs text-amber-700">{t('Order said')}{' '}{formatUsd(l.packCostUsd)}</span>}
              </label>
              {item?.perishable && (
                <label className="block">
                  <span className="label">{t('Expiry date')}</span>
                  <input className="input" type="date" value={g.expiryDate} onChange={(e) => set(l.itemId, { expiryDate: e.target.value })} />
                </label>
              )}
            </div>
          </div>
        )
      })}
      <label className="block">
        <span className="label">{t('Note (optional)')}</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Invoice number, who delivered…')} maxLength={300} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-stone-600">
          {t('This delivery:')}{' '}{formatUsd(total)} <span className="text-stone-400">({formatKhr(total, settings.usdToKhr)})</span>
        </span>
        <button className="btn" disabled={busy}>{busy ? t('Saving…') : t('Save receiving')}</button>
      </div>
    </form>
  )
}
