import { useMemo, useState, type FormEvent } from 'react'
import { limit, orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { cancelTransfer, receiveTransfer, sendTransfer } from '../lib/api'
import type { Item, StockLevel, Transfer } from '../lib/types'
import { formatQty } from '../lib/units'
import { Badge, Empty, ErrorNote, Modal, PageHeader, friendlyError } from '../components/ui'
import { dateLocale, t } from '../lib/i18n'

const when = (ts?: { toDate(): Date }) => (ts ? ts.toDate().toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '')

export function Transfers() {
  const me = useProfile()
  const { current } = useBranch()
  const id = current?.id ?? ''
  const incoming = useCollection<Transfer>(COL.transfers, [where('toBranchId', '==', id), orderBy('sentAt', 'desc'), limit(50)], `in${id}`, !current)
  const outgoing = useCollection<Transfer>(COL.transfers, [where('fromBranchId', '==', id), orderBy('sentAt', 'desc'), limit(50)], `out${id}`, !current)
  const [sending, setSending] = useState(false)
  const [receiving, setReceiving] = useState<Transfer | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>
  const canWork = canAtBranch(me, current.id, 'staff')
  const waiting = incoming.rows.filter((tr) => tr.status === 'sent')

  async function cancel(tr: Transfer) {
    if (!window.confirm(t('Cancel this transfer to {toName}? The stock comes back to {fromName}.', { toName: tr.toName, fromName: tr.fromName }))) return
    try {
      await cancelTransfer({ transferId: tr.id })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <>
      <PageHeader
        title={t('Transfers · {name}', { name: current.name })}
        subtitle={t('Send stock to another branch. It leaves here at once and arrives when they confirm.')}
        action={canWork && <button className="btn" onClick={() => setSending(true)}>{t('+ Send stock')}</button>}
      />
      <ErrorNote message={error ?? incoming.error ?? outgoing.error} />

      <h2 className="mb-2 font-semibold text-bean-900">{t('Coming to')}{' '}{current.name}</h2>
      {incoming.rows.length === 0 ? (
        <Empty>{t('Nothing on the way.')}</Empty>
      ) : (
        <div className="mb-6 space-y-2">
          {waiting.length > 0 && <p className="text-sm text-amber-700">{waiting.length}{' '}{t('waiting for you to confirm.')}</p>}
          {incoming.rows.map((tr) => (
            <TransferCard key={tr.id} tr={tr} other={t('From {name}', { name: tr.fromName })}>
              {tr.status === 'sent' && canWork && (
                <button className="btn" onClick={() => setReceiving(tr)}>
                  {t('Confirm received')}
                </button>
              )}
            </TransferCard>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-6 font-semibold text-bean-900">{t('Sent from')}{' '}{current.name}</h2>
      {outgoing.rows.length === 0 ? (
        <Empty>{t('Nothing sent yet.')}</Empty>
      ) : (
        <div className="space-y-2">
          {outgoing.rows.map((tr) => (
            <TransferCard key={tr.id} tr={tr} other={t('To {name}', { name: tr.toName })}>
              {tr.status === 'sent' && canWork && (
                <button className="btn-ghost" onClick={() => cancel(tr)}>
                  {t('Cancel')}
                </button>
              )}
            </TransferCard>
          ))}
        </div>
      )}
      {sending && <SendForm fromId={current.id} onClose={() => setSending(false)} />}
      {receiving && <ReceiveForm tr={receiving} onClose={() => setReceiving(null)} />}
    </>
  )
}

function TransferCard({ tr, other, children }: { tr: Transfer; other: string; children?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {tr.requestNumber && <span className="mr-1 text-xs font-semibold text-bean-500">{tr.requestNumber}</span>}
            {other}{' '}
            {tr.status === 'sent' ? <Badge tone="amber">{t('On the way')}</Badge> : tr.status === 'received' ? <Badge tone="green">{t('Received')}</Badge> : <Badge>{t('Cancelled')}</Badge>}
            {tr.short && <Badge tone="red">{t('Short')}</Badge>}
          </div>
          <div className="text-xs text-stone-400">
            {t('Sent')}{' '}{when(tr.sentAt)}{' '}{t('by')}{' '}{tr.sentByName}
            {tr.receivedAt && t(' · received {when} by {receivedByName}', { when: when(tr.receivedAt), receivedByName: tr.receivedByName })}
          </div>
        </div>
        {children}
      </div>
      <ul className="mt-2 text-sm">
        {tr.lines.map((l) => (
          <li key={l.itemId}>
            {l.itemName}: {formatQty(l.qty, l.baseUnit)}
            {l.receivedQty !== null && l.receivedQty !== l.qty && <span className="text-red-600">{' '}{t('(arrived {qty})', { qty: formatQty(l.receivedQty, l.baseUnit) })}</span>}
          </li>
        ))}
      </ul>
      {tr.note && <p className="mt-1 text-xs text-stone-500">{t('Note:')}{' '}{tr.note}</p>}
    </div>
  )
}

interface Draft {
  key: string
  itemId: string
  qty: string
  inPacks: boolean
}
let n = 0
const draft = (): Draft => ({ key: `t${++n}`, itemId: '', qty: '', inPacks: true })

function SendForm({ fromId, onClose }: { fromId: string; onClose: () => void }) {
  const { allBranches } = useBranch()
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', '==', fromId)], fromId)
  const [to, setTo] = useState('')
  const [lines, setLines] = useState<Draft[]>([draft()])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const itemById = useMemo(() => new Map(items.rows.map((i) => [i.id, i])), [items.rows])
  const onHand = (itemId: string) => levels.rows.find((s) => s.itemId === itemId)?.qty ?? 0
  const inStock = items.rows.filter((i) => onHand(i.id) > 0)
  const update = (key: string, p: Partial<Draft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const out = []
    for (const l of lines) {
      const item = itemById.get(l.itemId)
      const q = Number(l.qty)
      if (!item || !(q > 0)) return setError(t('Every line needs an item and a quantity.'))
      out.push({ itemId: item.id, qty: Math.round(q * (l.inPacks ? item.unitsPerPurchase : 1) * 10000) / 10000 })
    }
    setBusy(true)
    try {
      await sendTransfer({ fromBranchId: fromId, toBranchId: to, lines: out, note })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('Send stock')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        <label className="block">
          <span className="label">{t('To branch')}</span>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">{t('Choose…')}</option>
            {allBranches
              .filter((b) => b.id !== fromId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.name}
                </option>
              ))}
          </select>
        </label>
        {lines.map((l) => {
          const item = itemById.get(l.itemId)
          return (
            <div key={l.key} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
              <label className="block">
                <span className="label">{t('Item')}</span>
                <select className="input" value={l.itemId} onChange={(e) => update(l.key, { itemId: e.target.value })} required>
                  <option value="">{t('Choose…')}</option>
                  {inStock.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({formatQty(onHand(i.id), i.baseUnit)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">{t('Qty')}</span>
                <input className="input" type="number" min="0" step="any" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} required />
              </label>
              <label className="block">
                <span className="label">{t('Unit')}</span>
                <select className="input" value={l.inPacks ? 'p' : 'b'} onChange={(e) => update(l.key, { inPacks: e.target.value === 'p' })}>
                  <option value="p">{item ? item.purchaseUnit : t('pack')}</option>
                  <option value="b">{item ? item.baseUnit : t('base')}</option>
                </select>
              </label>
              <button type="button" className="pb-2 text-lg text-stone-400 hover:text-red-600" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} aria-label={t('Remove line')}>
                ×
              </button>
            </div>
          )
        })}
        <button type="button" className="btn-ghost w-full" onClick={() => setLines((ls) => [...ls, draft()])}>
          {t('+ Add item')}
        </button>
        <label className="block">
          <span className="label">{t('Note (optional)')}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{busy ? t('Sending…') : t('Send')}</button>
        </div>
      </form>
    </Modal>
  )
}

function ReceiveForm({ tr, onClose }: { tr: Transfer; onClose: () => void }) {
  const [got, setGot] = useState<Record<string, string>>(Object.fromEntries(tr.lines.map((l) => [l.itemId, String(l.qty)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await receiveTransfer({ transferId: tr.id, received: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, Number(v)])) })
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('Confirm stock from {fromName}', { fromName: tr.fromName })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-stone-600">{t('Check what really arrived. Change a number if something is missing.')}</p>
        <ErrorNote message={error} />
        {tr.lines.map((l) => (
          <label key={l.itemId} className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {l.itemName} <span className="text-stone-400">{t('(sent {qty})', { qty: formatQty(l.qty, l.baseUnit) })}</span>
            </span>
            <span className="flex items-center gap-1">
              <input
                className="input w-28 text-right"
                type="number"
                min="0"
                max={l.qty}
                step="any"
                value={got[l.itemId]}
                onChange={(e) => setGot({ ...got, [l.itemId]: e.target.value })}
              />
              <span className="text-xs text-stone-500">{l.baseUnit}</span>
            </span>
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn" disabled={busy}>{busy ? t('Saving…') : t('Confirm received')}</button>
        </div>
      </form>
    </Modal>
  )
}
