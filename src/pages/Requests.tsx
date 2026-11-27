import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { createRequest, requestAction, sendRequest } from '../lib/api'
import { baseToPacks, packsToBase, pickList, suggestPacks } from '../lib/requests'
import { isWarehouse, type Branch, type Item, type RequestStatus, type StockLevel, type StockRequest } from '../lib/types'
import { formatQty } from '../lib/units'
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, friendlyError } from '../components/ui'
import { dateLocale, t } from '../lib/i18n'

// Phase 7a: daily orders. A branch asks the main warehouse (ស្តុកធំ) for stock.
// The stock keeper checks the numbers and sends; that makes a normal transfer,
// which the branch confirms on the Transfers page when it arrives.

const when = (ts?: { toDate(): Date }) => (ts ? ts.toDate().toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '')
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
/** Today on this phone, as YYYY-MM-DD. */
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const STATUS: Record<RequestStatus, { label: string; tone: 'stone' | 'green' | 'amber' | 'red' }> = {
  requested: { label: t('Waiting for warehouse'), tone: 'amber' },
  sent: { label: t('On the way'), tone: 'amber' },
  received: { label: t('Received'), tone: 'green' },
  rejected: { label: t('Rejected'), tone: 'red' },
  cancelled: { label: t('Cancelled'), tone: 'stone' },
}

/** Daily orders a branch sent, or a warehouse received, newest first (also used by the dashboard). */
export function useRequests(location: Branch | null, max = 60) {
  const id = location?.id ?? ''
  const field = isWarehouse(location) ? 'warehouseId' : 'branchId'
  return useCollection<StockRequest>(COL.requests, [where(field, '==', id), orderBy('createdAt', 'desc'), limit(max)], `${field}${id}-${max}`, !location)
}

export function Requests() {
  const { current } = useBranch()
  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>
  return isWarehouse(current) ? <WarehouseView wh={current} /> : <BranchView branch={current} />
}

/** Packs for people, with the base amount when it is not a whole number of packs. */
function packsText(qty: number, l: { baseUnit: string; purchaseUnit: string; unitsPerPurchase: number }) {
  if (!(l.unitsPerPurchase > 1)) return formatQty(qty, l.baseUnit as 'g')
  return `${baseToPacks(qty, l.unitsPerPurchase)} × ${l.purchaseUnit} (${formatQty(qty, l.baseUnit as 'g')})`
}

function RequestCard({ r, other, children }: { r: StockRequest; other: string; children?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            <span className="mr-1 text-xs font-semibold text-bean-500">{r.number}</span> {other}{' '}
            <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
            {r.changed && r.status !== 'requested' && <Badge tone="amber">{t('Numbers changed')}</Badge>}
            {r.short && <Badge tone="red">{t('Short')}</Badge>}
          </div>
          <div className="text-xs text-stone-500">
            {t('For {day}', { day: day(r.neededDate) })} · {t('asked by {name}, {when}', { name: r.createdByName, when: when(r.createdAt) })}
            {r.sentByName && r.sentAt && t(' · sent by {name}, {when}', { name: r.sentByName, when: when(r.sentAt) })}
          </div>
        </div>
        {children}
      </div>
      <ul className="mt-2 text-sm">
        {r.lines.map((l) => (
          <li key={l.itemId}>
            {l.itemName}: {packsText(l.qty, l)}
            {l.sentQty !== null && l.sentQty !== l.qty && (
              <span className="text-amber-700">{' '}{t('(sent {qty})', { qty: formatQty(l.sentQty, l.baseUnit) })}</span>
            )}
          </li>
        ))}
      </ul>
      {r.note && <p className="mt-1 text-xs text-stone-500">{t('Note:')}{' '}{r.note}</p>}
      {r.sendNote && <p className="mt-1 text-xs text-stone-500">{t('Warehouse note:')}{' '}{r.sendNote}</p>}
      {r.closeReason && <p className="mt-1 text-xs text-red-700">{r.status === 'rejected' ? t('Rejected by {name}:', { name: r.closedByName }) : t('Note:')}{' '}{r.closeReason}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- branch side

function BranchView({ branch }: { branch: Branch }) {
  const me = useProfile()
  const { allBranches } = useBranch()
  const requests = useRequests(branch)
  const [error, setError] = useState<string | null>(null)
  const canWork = canAtBranch(me, branch.id, 'staff')
  const hasWarehouse = allBranches.some(isWarehouse)

  async function cancel(r: StockRequest) {
    if (!window.confirm(t('Cancel order {number}?', { number: r.number }))) return
    try {
      await requestAction({ id: r.id, action: 'cancel' })
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <>
      <PageHeader
        title={t('Daily orders · {name}', { name: branch.name })}
        subtitle={t('Ask the main warehouse for what you need. It comes as a transfer that you confirm when it arrives.')}
        action={canWork && hasWarehouse && <Link to="/requests/new" className="btn">{t('+ New daily order')}</Link>}
      />
      <ErrorNote message={error ?? requests.error} />
      {!hasWarehouse && <Empty>{t('There is no main warehouse yet. An admin can mark one on the Branches page.')}</Empty>}
      {hasWarehouse && requests.rows.length === 0 && <Empty>{requests.loading ? t('Loading…') : t('No daily orders yet.')}</Empty>}
      <div className="space-y-2">
        {requests.rows.map((r) => (
          <RequestCard key={r.id} r={r} other={t('To {name}', { name: r.warehouseName })}>
            {r.status === 'requested' && canWork && (
              <button className="btn-ghost" onClick={() => cancel(r)}>{t('Cancel')}</button>
            )}
            {r.status === 'sent' && canWork && (
              <Link to="/transfers" className="btn">{t('Confirm received')}</Link>
            )}
          </RequestCard>
        ))}
      </div>
    </>
  )
}

/** /requests/new: a branch writes today's order, item by item, in packs. */
export function NewRequest() {
  const me = useProfile()
  const nav = useNavigate()
  const { current, allBranches } = useBranch()
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', '==', current?.id ?? '')], current?.id ?? '', !current)
  const warehouses = allBranches.filter(isWarehouse)
  const [picked, setWhId] = useState('')
  // the branch's own warehouse first (set on the Branches page), else the first one
  const whId = picked || (warehouses.some((w) => w.id === current?.supplyFromId) ? current!.supplyFromId! : warehouses[0]?.id ?? '')
  const [neededDate, setNeededDate] = useState(today)
  const [packs, setPacks] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const level = useMemo(() => new Map(levels.rows.map((s) => [s.itemId, s])), [levels.rows])
  const active = items.rows.filter((i) => i.active)
  const shown = active.filter((i) => !find || i.name.toLowerCase().includes(find.trim().toLowerCase()))
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const i of shown) m.set(i.category || 'Other', [...(m.get(i.category || 'Other') ?? []), i])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [shown])
  const filled = active.filter((i) => (packsToBase(packs[i.id] ?? '', i.unitsPerPurchase) || 0) > 0).length

  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>
  if (isWarehouse(current)) return <Empty>{t('This is the main warehouse. Daily orders are written by the branches.')}</Empty>
  if (!canAtBranch(me, current.id, 'staff')) return <Empty>{t('You can only look at this branch.')}</Empty>

  function fillFromLevels() {
    const next: Record<string, string> = {}
    for (const i of active) {
      const s = level.get(i.id)
      const p = suggestPacks(s?.qty ?? 0, s?.parLevel ?? 0, s?.reorderPoint ?? i.defaultReorderPoint ?? 0, i.unitsPerPurchase)
      if (p > 0) next[i.id] = String(p)
    }
    setPacks(next)
    if (Object.keys(next).length === 0) setError(t('Nothing to suggest: every item is at its full level, or no levels are set on the Stock page.'))
    else setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const lines: { itemId: string; qty: number }[] = []
    for (const i of active) {
      const q = packsToBase(packs[i.id] ?? '', i.unitsPerPurchase)
      if (Number.isNaN(q)) return setError(t('{itemName}: the number is not right. Use 0 or more.', { itemName: i.name }))
      if (q > 0) lines.push({ itemId: i.id, qty: q })
    }
    if (lines.length === 0) return setError(t('Type how many you need for at least one item.'))
    setBusy(true)
    try {
      await createRequest({ branchId: current!.id, warehouseId: whId, neededDate, note, lines })
      nav('/requests')
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader title={t('New daily order · {name}', { name: current.name })} subtitle={t('Type how many packs you need. Leave the rest empty.')} />
      <Link to="/requests" className="mb-3 inline-block text-sm text-bean-700 hover:underline">{t('← All daily orders')}</Link>
      <ErrorNote message={error} />
      <div className="card mb-4 grid gap-3 sm:grid-cols-3">
        <Field label={t('Order from')}>
          <select className="input" value={whId} onChange={(e) => setWhId(e.target.value)} required>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('Needed on')}>
          <input className="input" type="date" value={neededDate} onChange={(e) => setNeededDate(e.target.value)} required />
        </Field>
        <div className="flex items-end">
          <button type="button" className="btn-ghost w-full" onClick={fillFromLevels}>{t('Fill from full levels')}</button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder={t('Find an item')} aria-label={t('Find an item')} value={find} onChange={(e) => setFind(e.target.value)} />
        <span className="text-sm text-stone-500">{t('{n} items on this order', { n: filled })}</span>
      </div>
      {groups.map(([cat, list]) => (
        <div key={cat} className="card mb-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{cat}</div>
          <ul className="divide-y divide-stone-100">
            {list.map((i) => {
              const s = level.get(i.id)
              const onHand = s?.qty ?? 0
              const low = onHand <= (s?.reorderPoint ?? i.defaultReorderPoint ?? 0)
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{i.name}</span>
                    <span className={`ml-2 text-xs ${low ? 'text-red-700' : 'text-stone-400'}`}>{t('have {qty}', { qty: formatQty(onHand, i.baseUnit) })}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <input
                      className="input w-20 text-right"
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={t('{itemName} packs needed', { itemName: i.name })}
                      value={packs[i.id] ?? ''}
                      onChange={(e) => setPacks((p) => ({ ...p, [i.id]: e.target.value }))}
                    />
                    <span className="w-24 text-xs text-stone-500">{i.unitsPerPurchase > 1 ? i.purchaseUnit : i.baseUnit}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className="card mb-3">
        <Field label={t('Note (optional)')}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. need it before 7 am')} />
        </Field>
      </div>
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-stone-200 bg-bean-50/95 px-4 py-3 backdrop-blur">
        <button className="btn" disabled={busy || filled === 0 || !whId}>{busy ? t('Sending…') : t('Send order ({n} items)', { n: filled })}</button>
        <Link to="/requests" className="btn-ghost">{t('Cancel')}</Link>
      </div>
    </form>
  )
}

// ------------------------------------------------------------- warehouse side

function WarehouseView({ wh }: { wh: Branch }) {
  const me = useProfile()
  const requests = useRequests(wh)
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', '==', wh.id)], wh.id)
  const [sending, setSending] = useState<StockRequest | null>(null)
  const [rejecting, setRejecting] = useState<StockRequest | null>(null)
  const canWork = canAtBranch(me, wh.id, 'staff')
  const waiting = requests.rows.filter((r) => r.status === 'requested').sort((a, b) => a.neededDate.localeCompare(b.neededDate))
  const done = requests.rows.filter((r) => r.status !== 'requested')
  const pick = pickList(waiting)
  const onHand = new Map(levels.rows.map((s) => [s.itemId, s.qty]))

  return (
    <>
      <PageHeader
        title={t('Daily orders to {name}', { name: wh.name })}
        subtitle={t('Orders from the branches. Check each one, change a number if you do not have enough, and send.')}
      />
      <ErrorNote message={requests.error} />
      {pick.length > 0 && (
        <div className="card mb-4">
          <h2 className="mb-2 font-semibold text-bean-900">{t('To pick for {n} waiting orders', { n: waiting.length })}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="py-1">{t('Item')}</th>
                <th className="py-1 text-right">{t('Asked')}</th>
                <th className="py-1 text-right">{t('In warehouse')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {pick.map((p) => {
                const have = onHand.get(p.itemId) ?? 0
                return (
                  <tr key={p.itemId} className={have < p.qty ? 'text-red-700' : ''}>
                    <td className="py-1">{p.itemName} <span className="text-xs text-stone-400">· {t('{n} orders', { n: p.orders })}</span></td>
                    <td className="py-1 text-right">{formatQty(p.qty, p.baseUnit as 'g')}</td>
                    <td className="py-1 text-right">{formatQty(have, p.baseUnit as 'g')}{have < p.qty && ` · ${t('not enough')}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="mb-2 font-semibold text-bean-900">{t('Waiting')}</h2>
      {waiting.length === 0 ? (
        <Empty>{requests.loading ? t('Loading…') : t('No orders waiting. Well done.')}</Empty>
      ) : (
        <div className="mb-6 space-y-2">
          {waiting.map((r) => (
            <RequestCard key={r.id} r={r} other={t('From {name}', { name: r.branchName })}>
              {canWork && (
                <div className="flex gap-2">
                  <button className="btn-ghost" onClick={() => setRejecting(r)}>{t('Reject')}</button>
                  <button className="btn" onClick={() => setSending(r)}>{t('Check and send')}</button>
                </div>
              )}
            </RequestCard>
          ))}
        </div>
      )}
      <h2 className="mb-2 mt-6 font-semibold text-bean-900">{t('Done')}</h2>
      {done.length === 0 ? (
        <Empty>{t('Nothing sent yet.')}</Empty>
      ) : (
        <div className="space-y-2">
          {done.map((r) => (
            <RequestCard key={r.id} r={r} other={t('From {name}', { name: r.branchName })} />
          ))}
        </div>
      )}
      {sending && <SendForm r={sending} onHand={onHand} onClose={() => setSending(null)} />}
      {rejecting && <RejectForm r={rejecting} onClose={() => setRejecting(null)} />}
    </>
  )
}

function SendForm({ r, onHand, onClose }: { r: StockRequest; onHand: Map<string, number>; onClose: () => void }) {
  // Start with what was asked, or what the warehouse has if that is less.
  const [packs, setPacks] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.lines.map((l) => [l.itemId, baseToPacks(Math.max(0, Math.min(l.qty, onHand.get(l.itemId) ?? 0)), l.unitsPerPurchase)])),
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const send: Record<string, number> = {}
    for (const l of r.lines) {
      const q = packsToBase(packs[l.itemId] ?? '', l.unitsPerPurchase)
      if (Number.isNaN(q)) return setError(t('{itemName}: the number is not right. Use 0 or more.', { itemName: l.itemName }))
      send[l.itemId] = q
    }
    setBusy(true)
    try {
      await sendRequest({ id: r.id, send, note })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('Send {number} to {name}', { number: r.number, name: r.branchName })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-stone-600">{t('Change a number if you send less (or more). 0 = do not send that item. Stock leaves the warehouse when you press Send.')}</p>
        <ErrorNote message={error} />
        {r.lines.map((l) => {
          const have = onHand.get(l.itemId) ?? 0
          return (
            <div key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
              <span className="text-sm">
                <span className="font-medium">{l.itemName}</span>
                <span className="block text-xs text-stone-500">
                  {t('asked {qty}', { qty: packsText(l.qty, l) })} · <span className={have < l.qty ? 'text-red-700' : ''}>{t('have {qty}', { qty: formatQty(have, l.baseUnit) })}</span>
                </span>
              </span>
              <span className="flex items-center gap-1">
                <input
                  className="input w-20 text-right"
                  inputMode="decimal"
                  aria-label={t('{itemName} packs to send', { itemName: l.itemName })}
                  value={packs[l.itemId] ?? ''}
                  onChange={(e) => setPacks((p) => ({ ...p, [l.itemId]: e.target.value }))}
                />
                <span className="w-20 text-xs text-stone-500">{l.unitsPerPurchase > 1 ? l.purchaseUnit : l.baseUnit}</span>
              </span>
            </div>
          )
        })}
        <Field label={t('Note for the branch (optional)')}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{busy ? t('Sending…') : t('Send')}</button>
        </div>
      </form>
    </Modal>
  )
}

function RejectForm({ r, onClose }: { r: StockRequest; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await requestAction({ id: r.id, action: 'reject', reason })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }
  return (
    <Modal title={t('Reject {number}', { number: r.number })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <Field label={t('Why? The branch will see this.')}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy || !reason.trim()}>{t('Reject order')}</button>
        </div>
      </form>
    </Modal>
  )
}
