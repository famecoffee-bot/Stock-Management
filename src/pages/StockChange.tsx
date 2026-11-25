import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { recordMovement, type ChangeLine, type ChangeType } from '../lib/api'
import { newDraft, toChangeLine, type DraftLine } from '../lib/lines'
import { WASTE_REASONS, type Item, type StockLevel } from '../lib/types'
import { formatQty, formatUsd } from '../lib/units'
import { Empty, ErrorNote, PageHeader, friendlyError } from '../components/ui'
import { OpenOrdersCard, PoReceive } from './PoReceive'
import { t } from '../lib/i18n'

const TEXT: Record<ChangeType, { tab: string; title: string; subtitle: string; button: string; need: 'staff' | 'manager' }> = {
  receive: { tab: t('Receive'), title: t('Receive stock'), subtitle: t('Goods that arrived from a supplier or the market.'), button: t('Save receiving'), need: 'staff' },
  waste: { tab: t('Waste'), title: t('Record waste'), subtitle: t('Anything thrown away, spilled, expired or used by staff.'), button: t('Save waste'), need: 'staff' },
  adjust: { tab: t('Adjust'), title: t('Adjust stock'), subtitle: t('Correct the number to what is really on the shelf. Managers only.'), button: t('Save adjustment'), need: 'manager' },
}

export function StockChange({ type }: { type: ChangeType }) {
  const me = useProfile()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const poId = type === 'receive' ? params.get('po') : null
  const { current } = useBranch()
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, current ? [where('branchId', '==', current.id)] : [], current?.id ?? '', !current)
  const [lines, setLines] = useState<DraftLine[]>([newDraft()])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const active = useMemo(() => items.rows.filter((i) => i.active), [items.rows])
  const itemById = useMemo(() => new Map(items.rows.map((i) => [i.id, i])), [items.rows])
  const onHand = (itemId: string) => levels.rows.find((s) => s.itemId === itemId)?.qty ?? 0
  const txt = TEXT[type]

  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>
  if (!canAtBranch(me, current.id, txt.need)) return <Empty>{t('You need')}{' '}{t(txt.need)}{' '}{t('rights at')}{' '}{current.name}{' '}{t('to do this.')}</Empty>

  const update = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!current) return
    setError(null)
    const out: ChangeLine[] = []
    for (const d of lines) {
      const r = toChangeLine(type, d, itemById.get(d.itemId), onHand(d.itemId))
      if ('error' in r) return setError(r.error)
      out.push(r)
    }
    setBusy(true)
    try {
      await recordMovement({ branchId: current.id, type, lines: out, note })
      setDone(t('Saved {n} line(s).', { n: out.length }))
      setLines([newDraft()])
      setNote('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const total =
    type === 'receive'
      ? lines.reduce((s, l) => s + (Number(l.qty) || 0) * (l.inPacks ? 1 : 1 / (itemById.get(l.itemId)?.unitsPerPurchase || 1)) * (Number(l.packCostUsd) || 0), 0)
      : 0

  return (
    <>
      <PageHeader title={`${txt.title} · ${current.name}`} subtitle={txt.subtitle} />
      <div className="mb-3 flex gap-2 text-sm">
        {(['receive', 'waste', 'adjust'] as ChangeType[])
          .filter((k) => canAtBranch(me, current.id, TEXT[k].need))
          .map((k) => (
            <Link key={k} to={`/stock/${k}`} className={k === type ? 'btn' : 'btn-ghost'}>
              {TEXT[k].tab}
            </Link>
          ))}
      </div>
      {poId ? (
        <PoReceive id={poId} />
      ) : (
      <>
      {type === 'receive' && <OpenOrdersCard branchId={current.id} />}
      <form onSubmit={submit} className="space-y-3">
        <ErrorNote message={error} />
        {done && (
          <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            {done}
            <button type="button" className="underline" onClick={() => nav('/stock')}>
              {t('See stock')}
            </button>
          </div>
        )}
        {lines.map((l, idx) => {
          const item = itemById.get(l.itemId)
          const unitLabel = item ? (l.inPacks ? item.purchaseUnit : item.baseUnit) : ''
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
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">{t('Item')}</span>
                  <select className="input" value={l.itemId} onChange={(e) => {
                    const it = itemById.get(e.target.value)
                    // start the cost at the last price paid, so staff only change it when the price changed
                    update(l.key, { itemId: e.target.value, ...(type === 'receive' && it ? { packCostUsd: String(it.lastCostUsd ?? '') } : {}) })
                  }} required>
                    <option value="">{t('Choose…')}</option>
                    {active.map((i) => (
                      <option key={i.id} value={i.id} disabled={lines.some((x) => x.key !== l.key && x.itemId === i.id)}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                  {item && <span className="mt-1 block text-xs text-stone-400">{t('On hand now:')}{' '}{formatQty(onHand(item.id), item.baseUnit)}</span>}
                </label>
                {item && (
                  <label className="block">
                    <span className="label">{t('Count in')}</span>
                    <select className="input" value={l.inPacks ? 'pack' : 'base'} onChange={(e) => update(l.key, { inPacks: e.target.value === 'pack' })}>
                      <option value="pack">
                        {item.purchaseUnit} ({formatQty(item.unitsPerPurchase, item.baseUnit)})
                      </option>
                      <option value="base">{item.baseUnit}</option>
                    </select>
                  </label>
                )}
              </div>
              {item && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {type === 'adjust' ? (
                    <label className="block">
                      <span className="label">{t('Real amount now ({unit})', { unit: unitLabel })}</span>
                      <input className="input" type="number" min="0" step="any" value={l.actual} onChange={(e) => update(l.key, { actual: e.target.value })} required />
                    </label>
                  ) : (
                    <label className="block">
                      <span className="label">{t('Quantity ({unit})', { unit: unitLabel })}</span>
                      <input className="input" type="number" min="0" step="any" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} required />
                    </label>
                  )}
                  {type === 'receive' && (
                    <label className="block">
                      <span className="label">{t('Cost per')}{' '}{item.purchaseUnit}{' '}{t('(USD)')}</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={String(item.lastCostUsd)}
                        value={l.packCostUsd}
                        onChange={(e) => update(l.key, { packCostUsd: e.target.value })}
                        required
                      />
                    </label>
                  )}
                  {type === 'receive' && item.perishable && (
                    <label className="block">
                      <span className="label">{t('Expiry date')}</span>
                      <input className="input" type="date" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} required />
                    </label>
                  )}
                  {type === 'waste' && (
                    <label className="block">
                      <span className="label">{t('Reason')}</span>
                      <select className="input" value={l.reason} onChange={(e) => update(l.key, { reason: e.target.value })} required>
                        <option value="">{t('Choose…')}</option>
                        {WASTE_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {type === 'adjust' && (
                    <label className="block sm:col-span-2">
                      <span className="label">{t('Why?')}</span>
                      <input className="input" value={l.reason} onChange={(e) => update(l.key, { reason: e.target.value })} placeholder={t('Counted the shelf')} required />
                    </label>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <button type="button" className="btn-ghost w-full" onClick={() => setLines((ls) => [...ls, newDraft()])}>
          {t('+ Add another item')}
        </button>
        <label className="block">
          <span className="label">{t('Note (optional)')}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'receive' ? t('Invoice number, supplier…') : ''} />
        </label>
        <div className="flex items-center justify-between gap-3">
          {type === 'receive' ? <span className="text-sm text-stone-600">{t('Total:')}{' '}{formatUsd(total)}</span> : <span />}
          <button className="btn" disabled={busy}>
            {busy ? t('Saving…') : txt.button}
          </button>
        </div>
      </form>
      </>
      )}
    </>
  )
}
