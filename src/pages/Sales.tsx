import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { recordSales, voidSale, type SaleInputLine } from '../lib/api'
import { importKey, parseSalesCsv, shopToday, sizeName, type ImportProblem } from '../lib/sales'
import type { Item, Product, Sale, StockLevel } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Badge, Empty, ErrorNote, PageHeader, friendlyError } from '../components/ui'
import { dateLocale, t } from '../lib/i18n'

// Sales: staff enter how many of each drink were sold (or import a CSV from the till),
// and the server takes the ingredients out of stock by recipe. Phase 7 will do this
// automatically from grove-system-kh's sales.

type Tab = 'enter' | 'import' | 'past'
const when = (ts?: { toDate(): Date }) => (ts ? ts.toDate().toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : '')

export function Sales() {
  const me = useProfile()
  const { current } = useBranch()
  const [tab, setTab] = useState<Tab>('enter')
  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>
  const staff = canAtBranch(me, current.id, 'staff')
  const shown: Tab = staff ? tab : 'past'
  return (
    <>
      <PageHeader title={t('Sales · {name}', { name: current.name })} subtitle={t('What was sold. Ingredients come out of stock by recipe.')} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {staff && (
          <>
            <button className={shown === 'enter' ? 'btn' : 'btn-ghost'} onClick={() => setTab('enter')}>{t('Enter sales')}</button>
            <button className={shown === 'import' ? 'btn' : 'btn-ghost'} onClick={() => setTab('import')}>{t('Import CSV')}</button>
          </>
        )}
        <button className={shown === 'past' ? 'btn' : 'btn-ghost'} onClick={() => setTab('past')}>{t('Past sales')}</button>
      </div>
      {shown === 'enter' && <EnterSales branchId={current.id} onSaved={() => setTab('past')} />}
      {shown === 'import' && <ImportSales branchId={current.id} onSaved={() => setTab('past')} />}
      {shown === 'past' && <PastSales branchId={current.id} />}
    </>
  )
}

function useMenu() {
  const products = useCollection<Product>(COL.products, [orderBy('name')])
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const itemById = useMemo(() => new Map(items.rows.map((i) => [i.id, i])), [items.rows])
  const menu = useMemo(() => products.rows.filter((p) => p.active), [products.rows])
  return { menu, products: products.rows, itemById, loading: products.loading }
}

/** Add up what a list of sale lines will take out of stock (preview only; the server does the real thing). */
function previewUsage(lines: SaleInputLine[], products: Product[]) {
  const byId = new Map(products.map((p) => [p.id, p]))
  const use = new Map<string, number>()
  for (const l of lines) {
    for (const r of byId.get(l.productId)?.recipes?.[l.sizeKey] ?? []) use.set(r.itemId, (use.get(r.itemId) ?? 0) + r.qty * l.qty)
  }
  return use
}

function UsagePreview({ use, itemById, levels }: { use: Map<string, number>; itemById: Map<string, Item>; levels: StockLevel[] }) {
  if (use.size === 0) return null
  return (
    <div className="card text-sm">
      <div className="mb-1 font-semibold text-bean-900">{t('This will take out of stock')}</div>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {[...use.entries()].map(([id, q]) => {
          const it = itemById.get(id)
          if (!it) return null
          const left = (levels.find((l) => l.itemId === id)?.qty ?? 0) - q
          return (
            <li key={id} className="flex justify-between gap-2">
              <span>{it.name}</span>
              <span className={left < 0 ? 'text-red-600' : 'text-stone-600'}>
                −{formatQty(q, it.baseUnit)} <span className="text-xs text-stone-400">→ {formatQty(left, it.baseUnit)}{' '}{t('left')}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function useLevels(branchId: string) {
  return useCollection<StockLevel>(COL.stock, [where('branchId', '==', branchId)], branchId)
}

function Saved({ result, onSaved }: { result: { negative: string[] }; onSaved: () => void }) {
  return (
    <div className="space-y-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
      <div>{t('Saved. The ingredients are taken out of stock.')}</div>
      {result.negative.length > 0 && (
        <div className="text-amber-800">
          {t('Now below zero:')}{' '}{result.negative.join(', ')}{t('. Some stock was probably not received in the app, or a recipe is too big. A manager can fix it with a count.')}
        </div>
      )}
      <button className="underline" onClick={onSaved}>{t('See past sales')}</button>
    </div>
  )
}

// ---------------------------------------------------------------- enter by hand

function EnterSales({ branchId, onSaved }: { branchId: string; onSaved: () => void }) {
  const { menu, products, itemById, loading } = useMenu()
  const levels = useLevels(branchId)
  const [date, setDate] = useState(shopToday())
  const [qty, setQty] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ negative: string[] } | null>(null)

  const lines: SaleInputLine[] = Object.entries(qty)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => {
      const [productId, sizeKey] = k.split('|')
      return { productId, sizeKey, qty: Number(v) }
    })
  const use = previewUsage(lines, products)
  const cups = lines.reduce((s, l) => s + l.qty, 0)
  const shown = menu.filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()))

  if (!loading && menu.length === 0) {
    return <Empty>{t('No menu yet. An owner adds drinks and their recipes on the')}{' '}<Link className="underline" to="/menu">{t('Menu')}</Link>{' '}{t('page.')}</Empty>
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (lines.length === 0) return setError(t('Enter how many were sold for at least one drink.'))
    setBusy(true)
    try {
      const r = await recordSales({ branchId, date, source: 'manual', note, lines })
      setDone(r)
      setQty({})
      setNote('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {done && <Saved result={done} onSaved={onSaved} />}
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">{t('Sales on')}</span>
          <input className="input" type="date" value={date} max={shopToday()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <input className="input max-w-xs" placeholder={t('Find a drink')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="card divide-y divide-stone-100 p-0">
        {shown.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span className="font-medium">
              {p.name}
              {p.sizes.some((s) => !(p.recipes?.[s.key]?.length)) && <span className="ml-2 text-xs font-normal text-amber-700">{t('no recipe yet')}</span>}
            </span>
            <span className="flex flex-wrap gap-2">
              {p.sizes.map((s) => {
                const k = `${p.id}|${s.key}`
                const noRecipe = !(p.recipes?.[s.key]?.length)
                return (
                  <label key={s.key} className="flex items-center gap-1 text-xs text-stone-500" title={noRecipe ? t('No recipe yet') : undefined}>
                    {p.sizes.length > 1 && <span className="w-4 text-right font-semibold">{s.key}</span>}
                    <input
                      className={`input w-20 py-1 text-right ${noRecipe ? 'bg-stone-100' : ''}`}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      disabled={noRecipe}
                      placeholder={noRecipe ? '—' : '0'}
                      value={qty[k] ?? ''}
                      onChange={(e) => setQty((q) => ({ ...q, [k]: e.target.value }))}
                      aria-label={sizeName(p, s)}
                    />
                  </label>
                )
              })}
            </span>
          </div>
        ))}
      </div>
      <UsagePreview use={use} itemById={itemById} levels={levels.rows} />
      <label className="block">
        <span className="label">{t('Note (optional)')}</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Morning shift, from the till report')} maxLength={300} />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-stone-600">{cups}{' '}{t('sold')}</span>
        <button className="btn" disabled={busy}>{busy ? t('Saving…') : t('Save sales')}</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- CSV import

function ImportSales({ branchId, onSaved }: { branchId: string; onSaved: () => void }) {
  const { products, itemById } = useMenu()
  const levels = useLevels(branchId)
  const [date, setDate] = useState(shopToday())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ negative: string[] } | null>(null)
  const byId = new Map(products.map((p) => [p.id, p]))
  const parsed = useMemo(() => {
    if (!text.trim()) return null
    const r = parseSalesCsv(text, products)
    // drinks with no recipe can't take stock out: skip them (listed with the other skipped lines)
    const known = new Map(products.map((p) => [p.id, p]))
    const ready = r.lines.filter((l) => known.get(l.productId)?.recipes?.[l.sizeKey]?.length)
    const noRecipe = r.lines
      .filter((l) => !ready.includes(l))
      .map((l) => {
        const p = known.get(l.productId)!
        const s = p.sizes.find((x) => x.key === l.sizeKey)!
        return { row: 0, text: `${sizeName(p, s)}, ${l.qty}`, reason: t('No recipe yet. Add it on the Menu page, then import again.') }
      })
    return { lines: ready, problems: [...r.problems, ...noRecipe] }
  }, [text, products])

  async function readFile(f: File | undefined) {
    if (!f) return
    setText(await f.text())
    setDone(null)
  }

  async function submit() {
    if (!parsed || parsed.lines.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const r = await recordSales({ branchId, date, source: 'import', key: importKey(date, text.trim()), lines: parsed.lines })
      setDone(r)
      setText('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {done && <Saved result={done} onSaved={onSaved} />}
      <ErrorNote message={error} />
      <div className="card space-y-2 text-sm text-stone-600">
        <p>
          {t('Paste or choose a file with one line per drink:')}{' '}<b>{t('product, size, number sold')}</b>{t('. For example:')}
        </p>
        <pre className="rounded-lg bg-stone-50 p-2 text-xs">{'Iced Latte, L, 12\nIced Latte (M), 8\nAmericano, 30'}</pre>
        <p className="text-xs">{t('The same file can\'t be imported twice for the same day, so nothing is counted double.')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">{t('Sales on')}</span>
          <input className="input" type="date" value={date} max={shopToday()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="btn-ghost cursor-pointer">
          {t('Choose CSV file')}
          <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
      </div>
      <textarea className="input h-32 font-mono text-xs" placeholder={t('…or paste here')} value={text} onChange={(e) => setText(e.target.value)} />
      {parsed && (
        <>
          {parsed.problems.length > 0 && <Problems problems={parsed.problems} />}
          {parsed.lines.length > 0 && (
            <div className="card p-0">
              <table className="w-full">
                <thead className="bg-stone-50">
                  <tr>
                    <th className="th">{t('Will record')}</th>
                    <th className="th text-right">{t('Sold')}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.lines.map((l) => {
                    const p = byId.get(l.productId)!
                    const s = p.sizes.find((x) => x.key === l.sizeKey)!
                    return (
                      <tr key={`${l.productId}|${l.sizeKey}`}>
                        <td className="td">{sizeName(p, s)}</td>
                        <td className="td text-right">{l.qty}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <UsagePreview use={previewUsage(parsed.lines, products)} itemById={itemById} levels={levels.rows} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-stone-600">
              {parsed.lines.length}{' '}{t('drink')}{parsed.lines.length === 1 ? '' : 's'}{' '}{t('matched')}
              {parsed.problems.length > 0 && ', ' + t('{n} line(s) skipped', { n: parsed.problems.length })}
            </span>
            <button className="btn" disabled={busy || parsed.lines.length === 0} onClick={submit}>
              {busy ? t('Saving…') : t('Import sales')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Problems({ problems }: { problems: ImportProblem[] }) {
  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <div className="mb-1 font-medium">{t('These lines will be skipped. Fix the file, or add the product on the Menu page:')}</div>
      <ul className="space-y-0.5 text-xs">
        {problems.slice(0, 20).map((p, i) => (
          <li key={i}>
            {p.row > 0 ? t('Line {row}', { row: p.row }) + ' ' : ''}<code className="rounded bg-white/60 px-1">{p.text}</code>: {p.reason}
          </li>
        ))}
        {problems.length > 20 && <li>{t('…and')}{' '}{problems.length - 20}{' '}{t('more')}</li>}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- history

function PastSales({ branchId }: { branchId: string }) {
  const me = useProfile()
  const settings = useSettings()
  const { rows, loading, error } = useCollection<Sale>(COL.sales, [where('branchId', '==', branchId), orderBy('createdAt', 'desc'), limit(60)], `sales${branchId}`)
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const manager = canAtBranch(me, branchId, 'manager')

  async function cancel(s: Sale) {
    const reason = window.prompt(t('Cancel the sales of {date} ({cups} sold)? The ingredients go back into stock.\n\nWhy?', { date: s.date, cups: s.cups }))
    if (!reason?.trim()) return
    try {
      await voidSale({ id: s.id, reason })
    } catch (e) {
      setErr(friendlyError(e))
    }
  }

  if (!loading && rows.length === 0) return <Empty>{t('No sales recorded yet.')}</Empty>
  return (
    <div className="space-y-2">
      <ErrorNote message={error ?? err} />
      {rows.map((s) => (
        <div key={s.id} className={`card ${s.status === 'void' ? 'opacity-60' : ''}`}>
          <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
            <span>
              <b>{s.date}</b> · {s.cups}{' '}{t('sold')}
              {s.source === 'import' && <Badge>{t('Import')}</Badge>}
              {s.status === 'void' && <Badge tone="red">{t('Cancelled')}</Badge>}
              <span className="block text-xs text-stone-400">
                {t('by')}{' '}{s.createdByName}, {when(s.createdAt)}
              </span>
            </span>
            <span className="text-right text-sm">
              {t('Ingredients')}{' '}{formatUsd(s.costUsd)}
              {s.salesUsd ? (
                <span className="block text-xs text-stone-500">
                  {t('of')}{' '}{formatUsd(s.salesUsd)}{' '}{t('sales ({pct}%)', { pct: Math.round((s.costUsd / s.salesUsd) * 100) })}
                </span>
              ) : (
                <span className="block text-xs text-stone-400">{formatKhr(s.costUsd, settings.usdToKhr)}</span>
              )}
            </span>
          </button>
          {open === s.id && (
            <div className="mt-3 grid gap-4 border-t border-stone-100 pt-3 text-sm sm:grid-cols-2">
              <div>
                <div className="label">{t('Sold')}</div>
                <ul className="space-y-0.5">
                  {s.lines.map((l) => (
                    <li key={`${l.productId}|${l.sizeKey}`} className="flex justify-between">
                      <span>
                        {l.productName}
                        {l.sizeLabel && l.sizeLabel !== 'One size' ? ` (${l.sizeLabel})` : ''}
                      </span>
                      <span>{l.qty}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="label">{t('Taken out of stock')}</div>
                <ul className="space-y-0.5">
                  {s.usage.map((u) => (
                    <li key={u.itemId} className="flex justify-between">
                      <span>{u.itemName}</span>
                      <span className={u.qtyAfter < 0 ? 'text-red-600' : ''}>{formatQty(u.qty, u.baseUnit)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {s.note && <p className="text-xs text-stone-500 sm:col-span-2">{t('Note:')}{' '}{s.note}</p>}
              {s.status === 'void' && (
                <p className="text-xs text-red-700 sm:col-span-2">{t('Cancelled by')}{' '}{s.voidedByName}: {s.voidReason}</p>
              )}
              {manager && s.status === 'done' && (
                <div className="sm:col-span-2">
                  <button className="text-sm text-red-600 hover:underline" onClick={() => cancel(s)}>
                    {t('Cancel these sales (entered by mistake)')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
