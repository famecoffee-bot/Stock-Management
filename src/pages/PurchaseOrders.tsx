import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useDocument, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { purchaseOrderAction, savePurchaseOrder, type PoAction } from '../lib/api'
import { PO_ACTIONS_FOR, isOpen, linesTotal, orderText, packsLabel, remainingPacks, suggestOrder } from '../lib/purchasing'
import { PO_STATUS_LABEL, type Item, type PoStatus, type PurchaseOrder, type StockLevel, type Supplier } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Badge, Empty, ErrorNote, Field, PageHeader, friendlyError } from '../components/ui'
import { telegramLink } from './Suppliers'
import { dateLocale, t } from '../lib/i18n'

const day = (ts?: { toDate(): Date }) => (ts ? ts.toDate().toLocaleDateString(dateLocale(), { dateStyle: 'medium' }) : '')
const when = (ts?: { toDate(): Date }) => (ts ? ts.toDate().toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '')

const TONE: Record<PoStatus, 'stone' | 'green' | 'amber' | 'red'> = {
  draft: 'stone',
  sent: 'amber',
  partial: 'amber',
  received: 'green',
  cancelled: 'red',
}

export function StatusBadge({ po }: { po: Pick<PurchaseOrder, 'status' | 'short'> }) {
  return <Badge tone={TONE[po.status]}>{po.status === 'received' && po.short ? t('Received (short)') : PO_STATUS_LABEL[po.status]}</Badge>
}

/** Open orders for a branch (sent or part received): used here and on the Receive screen. */
export function useOpenOrders(branchId: string | undefined) {
  const id = branchId ?? ''
  const q = useCollection<PurchaseOrder>(
    COL.purchaseOrders,
    [where('branchId', '==', id), where('status', 'in', ['sent', 'partial']), orderBy('createdAt', 'desc'), limit(30)],
    `open${id}`,
    !branchId,
  )
  return q
}

// ---------------------------------------------------------------- list

export function PurchaseOrders() {
  const me = useProfile()
  const settings = useSettings()
  const { current } = useBranch()
  const [params, setParams] = useSearchParams()
  const supplierId = params.get('supplier') ?? ''
  const [show, setShow] = useState<'open' | 'all'>('open')
  const id = current?.id ?? ''
  const { rows, loading, error } = useCollection<PurchaseOrder>(
    COL.purchaseOrders,
    [where('branchId', '==', id), orderBy('createdAt', 'desc'), limit(100)],
    `po${id}`,
    !current,
  )
  const list = rows.filter(
    (p) => (!supplierId || p.supplierId === supplierId) && (show === 'all' || p.status === 'draft' || isOpen(p.status)),
  )
  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>
  const manager = canAtBranch(me, current.id, 'manager')
  const supplierName = supplierId ? rows.find((p) => p.supplierId === supplierId)?.supplierName : null

  return (
    <>
      <PageHeader
        title={t('Purchase orders · {name}', { name: current.name })}
        subtitle={t('Order from suppliers, then receive the delivery against the order.')}
        action={manager && <Link className="btn" to={`/purchase-orders/new${supplierId ? `?supplier=${supplierId}` : ''}`}>{t('+ New order')}</Link>}
      />
      <ErrorNote message={error} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button className={show === 'open' ? 'btn' : 'btn-ghost'} onClick={() => setShow('open')}>{t('Open')}</button>
        <button className={show === 'all' ? 'btn' : 'btn-ghost'} onClick={() => setShow('all')}>{t('All')}</button>
        {supplierId && (
          <span className="flex items-center gap-1 rounded-full bg-bean-100 px-3 py-1 text-bean-900">
            {supplierName ?? t('One supplier')}
            <button aria-label={t('Show all suppliers')} onClick={() => setParams({})}>×</button>
          </span>
        )}
      </div>
      {!loading && list.length === 0 ? (
        <Empty>
          {show === 'open' ? t('No open orders.') : t('No orders yet.')}
          {manager && ' ' + t('Start one with "+ New order".')}
        </Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[600px]">
            <thead className="bg-stone-50">
              <tr>
                <th className="th">{t('Order')}</th>
                <th className="th">{t('Supplier')}</th>
                <th className="th">{t('Status')}</th>
                <th className="th">{t('Needed by')}</th>
                <th className="th text-right">{t('Total')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-bean-50">
                  <td className="td">
                    <Link className="font-medium text-bean-700 hover:underline" to={`/purchase-orders/${p.id}`}>{p.number}</Link>
                    <div className="text-xs text-stone-400">{day(p.createdAt)} · {p.lines.length}{' '}{t('item')}{p.lines.length === 1 ? '' : 's'}</div>
                  </td>
                  <td className="td">{p.supplierName}</td>
                  <td className="td"><StatusBadge po={p} /></td>
                  <td className="td">{p.expectedDate ?? '—'}</td>
                  <td className="td text-right">
                    {formatUsd(p.totalUsd)}
                    <div className="text-xs text-stone-400">{formatKhr(p.totalUsd, settings.usdToKhr)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- new / edit

interface Draft {
  key: string
  itemId: string
  packs: string
  packCostUsd: string
}
let n = 0
const blank = (): Draft => ({ key: `p${++n}`, itemId: '', packs: '', packCostUsd: '' })

function addDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function PurchaseOrderEdit() {
  const { id } = useParams()
  const existing = useDocument<PurchaseOrder>(COL.purchaseOrders, id)
  if (id && existing.loading) return <div className="p-6 text-sm text-stone-500">{t('Loading…')}</div>
  if (id && !existing.row) return <Empty>{t('Order not found.')}</Empty>
  if (existing.row && existing.row.status !== 'draft') return <Empty>{t('Only a draft can be changed.')}</Empty>
  return <OrderForm key={id ?? 'new'} po={existing.row} />
}

function OrderForm({ po }: { po: PurchaseOrder | null }) {
  const me = useProfile()
  const nav = useNavigate()
  const settings = useSettings()
  const [params] = useSearchParams()
  const { current } = useBranch()
  const branchId = po?.branchId ?? current?.id ?? ''
  const suppliers = useCollection<Supplier>(COL.suppliers, [orderBy('name')])
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', '==', branchId)], branchId, !branchId)
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? params.get('supplier') ?? '')
  const [expectedDate, setExpectedDate] = useState(po?.expectedDate ?? '')
  const [note, setNote] = useState(po?.note ?? '')
  const [lines, setLines] = useState<Draft[]>(
    po ? po.lines.map((l) => ({ key: `p${++n}`, itemId: l.itemId, packs: String(l.packs), packCostUsd: String(l.packCostUsd) })) : [blank()],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const itemById = useMemo(() => new Map(items.rows.map((i) => [i.id, i])), [items.rows])
  const supplier = suppliers.rows.find((s) => s.id === supplierId)
  const theirs = useMemo(() => new Set(supplier?.itemIds ?? []), [supplier])
  const activeItems = items.rows.filter((i) => i.active)
  const sold = activeItems.filter((i) => theirs.has(i.id))
  const others = activeItems.filter((i) => !theirs.has(i.id))
  const branchName = po?.branchName ?? current?.name ?? ''

  // a supplier chosen from the Suppliers page: suggest a delivery date from their usual lead time
  const leadDays = supplier?.leadTimeDays
  useEffect(() => {
    if (!po && leadDays !== undefined) setExpectedDate((d) => d || addDays(leadDays || 1))
  }, [po, leadDays])

  if (!branchId) return <Empty>{t('Choose a branch first.')}</Empty>
  if (!canAtBranch(me, branchId, 'manager')) return <Empty>{t('You need manager rights at')}{' '}{branchName}{' '}{t('to write orders.')}</Empty>

  const update = (key: string, patch: Partial<Draft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  function pickSupplier(sid: string) {
    setSupplierId(sid)
    const s = suppliers.rows.find((x) => x.id === sid)
    if (s && !expectedDate) setExpectedDate(addDays(s.leadTimeDays || 1))
  }

  function fillLow() {
    setInfo(null)
    const ideas = suggestOrder(sold, levels.rows).filter((s) => !lines.some((l) => l.itemId === s.item.id))
    if (ideas.length === 0) return setInfo(t('Nothing from this supplier is low right now.'))
    const add = ideas.map((s) => ({ key: `p${++n}`, itemId: s.item.id, packs: String(s.packs), packCostUsd: String(s.item.lastCostUsd) }))
    setLines((ls) => [...ls.filter((l) => l.itemId), ...add])
    setInfo(t('Added {n} low item(s). Check the quantities.', { n: add.length }))
  }

  const total = linesTotal(lines.map((l) => ({ packs: Number(l.packs), packCostUsd: Number(l.packCostUsd) })))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const out = []
    for (const l of lines) {
      const item = itemById.get(l.itemId)
      if (!item) return setError(t('Choose an item on every line, or remove the empty line.'))
      const packs = Number(l.packs)
      const cost = Number(l.packCostUsd)
      if (!(packs > 0)) return setError(t('{name}: enter how many {purchaseUnit} to order.', { name: item.name, purchaseUnit: item.purchaseUnit }))
      if (l.packCostUsd.trim() === '' || !(cost >= 0)) return setError(t('{name}: enter the price (0 if free).', { name: item.name }))
      out.push({ itemId: item.id, packs, packCostUsd: cost })
    }
    setBusy(true)
    try {
      const r = await savePurchaseOrder({ id: po?.id, branchId, supplierId, expectedDate: expectedDate || undefined, note, lines: out })
      nav(`/purchase-orders/${r.id}`)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={po ? t('Edit {number}', { number: po.number }) : t('New purchase order')} subtitle={t('Delivers to {branchName}', { branchName })} />
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <div className="card grid gap-3 sm:grid-cols-2">
          <Field label={t('Supplier')}>
            <select className="input" value={supplierId} onChange={(e) => pickSupplier(e.target.value)} required>
              <option value="">{t('Choose…')}</option>
              {suppliers.rows
                .filter((s) => s.active || s.id === supplierId)
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          </Field>
          <Field label={t('Needed by')} hint={supplier?.leadTimeDays ? t('They usually take {leadTimeDays} day(s).', { leadTimeDays: supplier.leadTimeDays }) : undefined}>
            <input className="input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
          {suppliers.rows.length === 0 && !suppliers.loading && (
            <p className="text-sm text-stone-500 sm:col-span-2">
              {t('No suppliers yet.')}{' '}<Link className="text-bean-700 underline" to="/suppliers">{t('Add one first')}</Link>.
            </p>
          )}
        </div>
        {supplier && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost" onClick={fillLow}>{t('Fill with low-stock items')}</button>
            {info && <span className="text-sm text-stone-600">{info}</span>}
          </div>
        )}
        {lines.map((l, idx) => {
          const item = itemById.get(l.itemId)
          return (
            <div key={l.key} className="card space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-400">{t('Line')}{' '}{idx + 1}</span>
                {lines.length > 1 && (
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    {t('Remove')}
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <Field label={t('Item')}>
                  <select
                    className="input"
                    value={l.itemId}
                    onChange={(e) => {
                      const it = itemById.get(e.target.value)
                      update(l.key, { itemId: e.target.value, packCostUsd: it ? String(it.lastCostUsd ?? '') : '' })
                    }}
                    required
                  >
                    <option value="">{t('Choose…')}</option>
                    {sold.length > 0 && (
                      <optgroup label={t('Sold by {name}', { name: supplier?.name })}>
                        {sold.map((i) => (
                          <option key={i.id} value={i.id} disabled={lines.some((x) => x.key !== l.key && x.itemId === i.id)}>{i.name}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={sold.length ? t('Other items') : t('Items')}>
                      {others.map((i) => (
                        <option key={i.id} value={i.id} disabled={lines.some((x) => x.key !== l.key && x.itemId === i.id)}>{i.name}</option>
                      ))}
                    </optgroup>
                  </select>
                </Field>
                <Field label={t('How many {unit}', { unit: item ? item.purchaseUnit : '' })}>
                  <input className="input" type="number" min="0" step="any" value={l.packs} onChange={(e) => update(l.key, { packs: e.target.value })} required />
                </Field>
                <Field label={t('Price each (USD)')}>
                  <input className="input" type="number" min="0" step="0.01" value={l.packCostUsd} onChange={(e) => update(l.key, { packCostUsd: e.target.value })} required />
                </Field>
                <div className="pb-2 text-right text-sm font-medium text-stone-700">
                  {formatUsd((Number(l.packs) || 0) * (Number(l.packCostUsd) || 0))}
                </div>
              </div>
              {item && (
                <div className="text-xs text-stone-400">
                  {t('On hand:')}{' '}{formatQty(levels.rows.find((s) => s.itemId === item.id)?.qty ?? 0, item.baseUnit)}
                  {Number(l.packs) > 0 && t(' · this order adds {qty}', { qty: formatQty(Number(l.packs) * item.unitsPerPurchase, item.baseUnit) })}
                </div>
              )}
            </div>
          )
        })}
        <button type="button" className="btn-ghost w-full" onClick={() => setLines((ls) => [...ls, blank()])}>{t('+ Add another item')}</button>
        <Field label={t('Note for the supplier (optional)')}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Deliver before 9 am, call on arrival')} maxLength={300} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-stone-700">
            {t('Total:')}{' '}<b>{formatUsd(total)}</b> <span className="text-stone-400">({formatKhr(total, settings.usdToKhr)})</span>
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => nav(-1)}>{t('Cancel')}</button>
            <button className="btn" disabled={busy}>{busy ? t('Saving…') : t('Save draft')}</button>
          </div>
        </div>
      </form>
    </>
  )
}

// ---------------------------------------------------------------- one order

const ACTION_TEXT: Record<PoAction, { label: string; confirm?: string; ghost?: boolean }> = {
  send: { label: t('Mark as sent') },
  reopen: { label: t('Back to draft'), ghost: true },
  cancel: { label: t('Cancel order'), confirm: t('Cancel this order? It stays in the list as cancelled.'), ghost: true },
  close: { label: t('Close: rest is not coming'), confirm: t('Stop waiting for the rest of this order? What arrived is kept.'), ghost: true },
}

export function PurchaseOrderView() {
  const { id } = useParams()
  const me = useProfile()
  const settings = useSettings()
  const { row: po, loading, error } = useDocument<PurchaseOrder>(COL.purchaseOrders, id)
  const supplier = useDocument<Supplier>(COL.suppliers, po?.supplierId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (loading) return <div className="p-6 text-sm text-stone-500">{t('Loading…')}</div>
  if (!po) return <Empty>{error ? friendlyError(error) : t('Order not found.')}</Empty>

  const manager = canAtBranch(me, po.branchId, 'manager')
  const staff = canAtBranch(me, po.branchId, 'staff')
  const text = orderText(po, settings.usdToKhr)
  const tg = supplier.row?.telegram

  async function act(action: PoAction) {
    const act = ACTION_TEXT[action]
    if (act.confirm && !window.confirm(act.confirm)) return
    setBusy(true)
    setErr(null)
    try {
      await purchaseOrderAction({ id: po!.id, action })
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setErr(t('Could not copy. Select the text below and copy it by hand.'))
    }
  }

  return (
    <>
      <PageHeader
        title={`${po.number} · ${po.supplierName}`}
        subtitle={t('For {branchName} · written by {createdByName} on {day}{v}', { branchName: po.branchName, createdByName: po.createdByName, day: day(po.createdAt), v: po.expectedDate ? ' · ' + t('needed by {date}', { date: po.expectedDate }) : '' })}
        action={<StatusBadge po={po} />}
      />
      <ErrorNote message={err} />
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        {staff && isOpen(po.status) && (
          <Link className="btn" to={`/stock/receive?po=${po.id}`}>{t('Receive delivery')}</Link>
        )}
        {manager && po.status === 'draft' && <Link className="btn-ghost" to={`/purchase-orders/${po.id}/edit`}>{t('Edit')}</Link>}
        {manager &&
          PO_ACTIONS_FOR[po.status].map((a) => (
            <button key={a} className={ACTION_TEXT[a].ghost ? 'btn-ghost' : 'btn'} disabled={busy} onClick={() => act(a)}>
              {ACTION_TEXT[a].label}
            </button>
          ))}
        {po.status !== 'cancelled' && (
          <>
            <button className="btn-ghost" onClick={copy}>{copied ? t('Copied ✓') : t('Copy order text')}</button>
            {tg && (
              <a className="btn-ghost" href={telegramLink(tg)} target="_blank" rel="noreferrer">{t('Open Telegram')}</a>
            )}
            <button className="btn-ghost" onClick={() => window.print()}>{t('Print')}</button>
          </>
        )}
      </div>
      {po.status === 'draft' && manager && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden">
          {t('This is a draft. Send it to')}{' '}{po.supplierName}{' '}{t('(copy the text into Telegram, or print it), then press "Mark as sent".')}
        </p>
      )}

      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[600px]">
          <thead className="bg-stone-50">
            <tr>
              <th className="th">{t('Item')}</th>
              <th className="th text-right">{t('Ordered')}</th>
              <th className="th text-right">{t('Received')}</th>
              <th className="th text-right">{t('Price each')}</th>
              <th className="th text-right">{t('Line total')}</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => {
              const left = remainingPacks(l)
              return (
                <tr key={l.itemId}>
                  <td className="td font-medium">{l.itemName}</td>
                  <td className="td text-right">{packsLabel(l.packs, l)}</td>
                  <td className="td text-right">
                    {l.receivedPacks || 0}
                    {left > 0 && isOpen(po.status) && <div className="text-xs text-amber-700">{left}{' '}{t('still to come')}</div>}
                    {left > 0 && po.status === 'received' && <div className="text-xs text-red-600">{left}{' '}{t('never came')}</div>}
                  </td>
                  <td className="td text-right">
                    {formatUsd(l.packCostUsd)}
                    {l.receivedCostUsd !== undefined && l.receivedCostUsd !== l.packCostUsd && (
                      <div className="text-xs text-amber-700">{t('charged')}{' '}{formatUsd(l.receivedCostUsd)}</div>
                    )}
                  </td>
                  <td className="td text-right">{formatUsd(l.packs * l.packCostUsd)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="td font-semibold" colSpan={4}>{t('Total')}</td>
              <td className="td text-right font-semibold">
                {formatUsd(po.totalUsd)}
                <div className="text-xs font-normal text-stone-400">{formatKhr(po.totalUsd, settings.usdToKhr)}</div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {po.note && <p className="mb-4 text-sm text-stone-600">{t('Note:')}{' '}{po.note}</p>}

      {supplier.row && (
        <div className="card mb-4 text-sm print:hidden">
          <div className="font-semibold text-bean-900">{supplier.row.name}</div>
          <div className="text-stone-600">
            {[supplier.row.contactName, supplier.row.phone, supplier.row.telegram, supplier.row.paymentTerms].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}

      {po.receipts?.length > 0 && (
        <div className="card mb-4 print:hidden">
          <h2 className="mb-2 font-semibold text-bean-900">{t('Deliveries')}</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {po.receipts.map((r, i) => (
              <li key={i} className="py-2">
                <div className="text-stone-500">{when(r.at)}{' '}{t('· received by')}{' '}{r.byName}{r.note ? ` · ${r.note}` : ''}</div>
                <div>
                  {r.lines
                    .map((x) => `${po.lines.find((l) => l.itemId === x.itemId)?.itemName ?? x.itemId}: ${x.packs}`)
                    .join(', ')}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="card text-sm print:hidden">
        <summary className="cursor-pointer font-semibold text-bean-900">{t('Order text and history')}</summary>
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-xs">{text}</pre>
        <ul className="mt-3 space-y-1 text-xs text-stone-500">
          {po.log?.map((e, i) => (
            <li key={i}>{when(e.at)} · {PO_STATUS_LABEL[e.status]} · {e.byName}</li>
          ))}
        </ul>
      </details>
    </>
  )
}
