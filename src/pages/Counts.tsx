import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useDocument, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { canAtBranch } from '../lib/permissions'
import { approveCount, cancelCount, saveCount, startCount } from '../lib/api'
import { baseToEntry, bigDifference, entryToBase, previewTotals, type CountEntry } from '../lib/counts'
import type { CountLine, StockCount } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Badge, Empty, ErrorNote, PageHeader, friendlyError } from '../components/ui'

// Phase 5: stock counts. Staff count the shelf without seeing what the app expects
// (a "blind count"), a manager reviews the differences and approves, and only then
// does stock change. The difference between expected and counted is the VARIANCE.

/** -2.4 -> "−$2.40", 1.35 -> "+$1.35" */
const signedUsd = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${formatUsd(Math.abs(v))}`
const when = (t?: { toDate(): Date }) => (t ? t.toDate().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const STATUS: Record<StockCount['status'], { label: string; tone: 'stone' | 'green' | 'amber' | 'red' }> = {
  open: { label: 'Counting', tone: 'amber' },
  submitted: { label: 'Waiting for approval', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'stone' },
}

/** Counts at a branch, newest first (also used by the dashboard). */
export function useCounts(branchId: string | undefined, max = 30) {
  return useCollection<StockCount>(COL.counts, [where('branchId', '==', branchId ?? ''), orderBy('createdAt', 'desc'), limit(max)], `${branchId}-${max}`, !branchId)
}

export function Counts() {
  const me = useProfile()
  const settings = useSettings()
  const nav = useNavigate()
  const { current } = useBranch()
  const counts = useCounts(current?.id)
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!current) return <Empty>Choose a branch first.</Empty>
  const staff = canAtBranch(me, current.id, 'staff')
  const open = counts.rows.find((c) => c.status === 'open' || c.status === 'submitted')

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const r = await startCount({ branchId: current!.id, ...(category ? { category } : {}) })
      nav(`/counts/${r.id}`)
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={`Stock counts · ${current.name}`} subtitle="Count what is really on the shelf. The difference from the app is your variance." />
      <ErrorNote message={error} />
      {open ? (
        <div className="card mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-bean-900">A count is in progress</div>
            <div className="text-sm text-stone-500">
              Started by {open.createdByName}, {when(open.createdAt)} · {open.lines.filter((l) => l.counted !== null).length} of {open.lines.length} counted
            </div>
          </div>
          <Link to={`/counts/${open.id}`} className="btn">{open.status === 'submitted' ? 'Review' : 'Continue counting'}</Link>
        </div>
      ) : (
        staff && (
          <div className="card mb-5">
            <div className="mb-2 font-semibold text-bean-900">Start a count</div>
            <p className="mb-3 text-sm text-stone-500">
              Count everything once a month, and the costly items (beans, milk) every week. You can keep selling while you count.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="label">What to count</span>
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="What to count">
                  <option value="">Everything</option>
                  {settings.categories.map((c) => (
                    <option key={c} value={c}>Only {c}</option>
                  ))}
                </select>
              </label>
              <button className="btn" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start count'}</button>
            </div>
          </div>
        )
      )}
      <h2 className="mb-2 font-semibold text-bean-900">Past counts</h2>
      {counts.rows.length === 0 ? (
        <Empty>{counts.loading ? 'Loading…' : 'No counts yet.'}</Empty>
      ) : (
        <div className="card divide-y divide-stone-100 p-0">
          {counts.rows.map((c) => (
            <Link key={c.id} to={`/counts/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-stone-50">
              <div>
                <div className="font-medium">
                  {c.category ? `${c.category} only` : 'Everything'} <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                </div>
                <div className="text-xs text-stone-500">by {c.createdByName}, {when(c.createdAt)}</div>
              </div>
              {c.totals && (
                <div className="text-right text-sm">
                  <div className={c.totals.netUsd < 0 ? 'text-red-700' : 'text-stone-700'}>
                    {c.totals.netUsd < 0 ? 'Missing ' : 'Net '}
                    {formatUsd(Math.abs(c.totals.netUsd))}
                  </div>
                  <div className="text-xs text-stone-400">{c.totals.differences} differences in {c.totals.counted} items</div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
      {open && staff && <p className="mt-3 text-xs text-stone-400">Only one count at a time per branch. Finish or cancel the open one to start another.</p>}
    </>
  )
}

export function CountSheet() {
  const { id } = useParams()
  const me = useProfile()
  const { row: count, loading } = useDocument<StockCount>(COL.counts, id)
  if (loading) return <Empty>Loading…</Empty>
  if (!count) return <Empty>Count not found. <Link to="/counts" className="underline">Back to counts</Link></Empty>
  const staff = canAtBranch(me, count.branchId, 'staff')
  const manager = canAtBranch(me, count.branchId, 'manager')
  const title = `Count · ${count.category ? `${count.category} only` : 'everything'}`
  const sub = `Started by ${count.createdByName}, ${when(count.createdAt)}`
  return (
    <>
      <PageHeader title={title} subtitle={sub} action={<Badge tone={STATUS[count.status].tone}>{STATUS[count.status].label}</Badge>} />
      <Link to="/counts" className="mb-3 inline-block text-sm text-bean-700 hover:underline">← All counts</Link>
      {count.status === 'open' && staff && <Counting key={count.id} count={count} canCancel={manager || count.createdBy === me.id} />}
      {count.status === 'open' && !staff && <Empty>This count is still in progress.</Empty>}
      {count.status === 'submitted' && manager && <Review key={count.id} count={count} />}
      {count.status === 'submitted' && !manager && (
        <Empty>Counted by {count.submittedByName}. Waiting for a manager to check the differences and approve.</Empty>
      )}
      {count.status === 'approved' && <Result count={count} />}
      {count.status === 'cancelled' && <Empty>Cancelled by {count.cancelledByName}. Stock was not changed.</Empty>}
    </>
  )
}

type Entries = Record<string, CountEntry>
const initialEntries = (lines: CountLine[]): Entries => Object.fromEntries(lines.map((l) => [l.itemId, baseToEntry(l.counted, l.unitsPerPurchase)]))

/** Turn the boxes into numbers for the server; returns an error for the first bad number. */
function collect(lines: CountLine[], entries: Entries): { counted: Record<string, number | null> } | { error: string } {
  const counted: Record<string, number | null> = {}
  for (const l of lines) {
    const v = entryToBase(entries[l.itemId] ?? { packs: '', loose: '' }, l.unitsPerPurchase)
    if (Number.isNaN(v)) return { error: `${l.itemName}: the number is not right. Use 0 or more.` }
    counted[l.itemId] = v
  }
  return { counted }
}

function EntryBoxes({ line, value, onChange }: { line: CountLine; value: CountEntry; onChange: (v: CountEntry) => void }) {
  const packs = line.unitsPerPurchase > 1
  const total = entryToBase(value, line.unitsPerPurchase)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {packs && (
        <>
          <input
            className="input w-20"
            inputMode="decimal"
            aria-label={`${line.itemName} full packs`}
            placeholder="0"
            value={value.packs}
            onChange={(e) => onChange({ ...value, packs: e.target.value })}
          />
          <span className="text-xs text-stone-500">{line.purchaseUnit || 'packs'} +</span>
        </>
      )}
      <input
        className="input w-24"
        inputMode="decimal"
        aria-label={packs ? `${line.itemName} open ${line.baseUnit}` : line.itemName}
        placeholder={packs ? 'open' : '0'}
        value={value.loose}
        onChange={(e) => onChange({ ...value, loose: e.target.value })}
      />
      <span className="text-xs text-stone-500">{line.baseUnit}</span>
      {packs && total !== null && !Number.isNaN(total) && <span className="text-xs text-stone-400">= {formatQty(total, line.baseUnit)}</span>}
    </div>
  )
}

function Counting({ count, canCancel }: { count: StockCount; canCancel: boolean }) {
  const nav = useNavigate()
  const [entries, setEntries] = useState<Entries>(() => initialEntries(count.lines))
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'submit' | 'cancel'>('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const done = count.lines.filter((l) => entryToBase(entries[l.itemId], l.unitsPerPurchase) !== null).length
  const shown = count.lines.filter((l) => !find || l.itemName.toLowerCase().includes(find.trim().toLowerCase()))
  const groups = useMemo(() => {
    const m = new Map<string, CountLine[]>()
    for (const l of shown) m.set(l.category, [...(m.get(l.category) ?? []), l])
    return [...m.entries()]
  }, [shown])

  async function save(submit: boolean) {
    const c = collect(count.lines, entries)
    if ('error' in c) return setError(c.error)
    setBusy(submit ? 'submit' : 'save')
    setError(null)
    try {
      const r = await saveCount({ id: count.id, counted: c.counted, submit })
      setSaved(submit ? null : `Saved. ${r.counted} of ${r.total} counted.`)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy('')
    }
  }

  async function cancel() {
    if (!window.confirm('Cancel this count? What was typed is thrown away and stock does not change.')) return
    setBusy('cancel')
    try {
      await cancelCount({ id: count.id })
      nav('/counts')
    } catch (e) {
      setError(friendlyError(e))
      setBusy('')
    }
  }

  return (
    <>
      <div className="card mb-4 text-sm text-stone-600">
        Count what is <b>really on the shelf</b>, including open packs. The app's number is hidden on purpose, so you count instead of copying.
        Leave an item blank if you did not count it. Save often; others at this branch can help count the same sheet.
      </div>
      <ErrorNote message={error} />
      {saved && <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{saved}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Find an item" aria-label="Find an item" value={find} onChange={(e) => setFind(e.target.value)} />
        <span className="text-sm text-stone-500">{done} of {count.lines.length} counted</span>
      </div>
      {groups.map(([cat, lines]) => (
        <div key={cat} className="card mb-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{cat}</div>
          <ul className="divide-y divide-stone-100">
            {lines.map((l) => (
              <li key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{l.itemName}</span>
                <EntryBoxes line={l} value={entries[l.itemId]} onChange={(v) => { setSaved(null); setEntries((e) => ({ ...e, [l.itemId]: v })) }} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-stone-200 bg-bean-50/95 px-4 py-3 backdrop-blur">
        <button className="btn-ghost" onClick={() => save(false)} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save progress'}</button>
        <button className="btn" onClick={() => save(true)} disabled={!!busy || done === 0}>{busy === 'submit' ? 'Sending…' : 'Finish counting'}</button>
        {canCancel && <button className="ml-auto text-sm text-red-700 hover:underline" onClick={cancel} disabled={!!busy}>Cancel count</button>}
      </div>
    </>
  )
}

function Review({ count }: { count: StockCount }) {
  const settings = useSettings()
  const nav = useNavigate()
  const [entries, setEntries] = useState<Entries>(() => initialEntries(count.lines))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [onlyDiff, setOnlyDiff] = useState(true)

  // the numbers as they are now in the boxes (a manager may correct a miscount before approving)
  const lines = useMemo(
    () => count.lines.map((l) => ({ ...l, counted: (() => { const v = entryToBase(entries[l.itemId], l.unitsPerPurchase); return Number.isNaN(v) ? l.counted : v })() })),
    [count.lines, entries],
  )
  const t = previewTotals(lines)
  const counted = lines.filter((l) => l.counted !== null)
  const shown = counted
    .filter((l) => !onlyDiff || l.counted !== l.expected)
    .sort((a, b) => Math.abs((b.counted! - b.expected) * b.avgCostUsd) - Math.abs((a.counted! - a.expected) * a.avgCostUsd))
  const notCounted = lines.length - counted.length

  useEffect(() => setError(null), [entries])

  async function approve() {
    const c = collect(count.lines, entries)
    if ('error' in c) return setError(c.error)
    if (!window.confirm(`Approve? Stock will be changed for ${t.differences} item(s).`)) return
    setBusy(true)
    try {
      await saveCount({ id: count.id, counted: c.counted })
      await approveCount({ id: count.id })
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }
  async function cancel() {
    if (!window.confirm('Cancel this count? Stock does not change.')) return
    setBusy(true)
    try {
      await cancelCount({ id: count.id })
      nav('/counts')
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-stone-500">Missing</div>
          <div className="text-2xl font-semibold text-red-700">{formatUsd(t.lossUsd)}</div>
          <div className="text-xs text-stone-400">{formatKhr(t.lossUsd, settings.usdToKhr)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-stone-500">Found extra</div>
          <div className="text-2xl font-semibold text-bean-900">{formatUsd(t.gainUsd)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-stone-500">Items</div>
          <div className="text-2xl font-semibold text-bean-900">{t.differences} <span className="text-base font-normal text-stone-500">differ</span></div>
          <div className="text-xs text-stone-400">{t.counted} counted{notCounted ? `, ${notCounted} not counted (unchanged)` : ''}</div>
        </div>
      </div>
      <ErrorNote message={error} />
      <div className="card mb-4 overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="font-semibold text-bean-900">Counted by {count.submittedByName}</div>
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only differences
          </label>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-2 py-2 text-right">App said</th>
              <th className="px-2 py-2">Counted</th>
              <th className="px-2 py-2 text-right">Difference</th>
              <th className="px-4 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-stone-500">No differences. Everything matches.</td>
              </tr>
            )}
            {shown.map((l) => {
              const d = l.counted! - l.expected
              return (
                <tr key={l.itemId} className={bigDifference(l) ? 'bg-amber-50' : ''}>
                  <td className="px-4 py-2">
                    {l.itemName}
                    {bigDifference(l) && <div className="text-xs text-amber-700">Big difference: count again?</div>}
                  </td>
                  <td className="px-2 py-2 text-right text-stone-500">{formatQty(l.expected, l.baseUnit)}</td>
                  <td className="px-2 py-2">
                    <EntryBoxes line={l} value={entries[l.itemId]} onChange={(v) => setEntries((e) => ({ ...e, [l.itemId]: v }))} />
                  </td>
                  <td className={`px-2 py-2 text-right ${d < 0 ? 'text-red-700' : d > 0 ? 'text-green-700' : 'text-stone-400'}`}>
                    {d > 0 ? '+' : ''}
                    {formatQty(d, l.baseUnit)}
                  </td>
                  <td className={`px-4 py-2 text-right ${d < 0 ? 'text-red-700' : 'text-stone-600'}`}>{signedUsd(d * l.avgCostUsd)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mb-3 text-sm text-stone-500">
        Approving sets stock to what was counted. Sales and deliveries made while counting are kept, because only the difference is applied.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={approve} disabled={busy}>{busy ? 'Approving…' : 'Approve and update stock'}</button>
        <button className="ml-auto text-sm text-red-700 hover:underline" onClick={cancel} disabled={busy}>Cancel count</button>
      </div>
    </>
  )
}

function Result({ count }: { count: StockCount }) {
  const settings = useSettings()
  const t = count.totals
  const diffs = count.lines
    .filter((l) => l.variance)
    .sort((a, b) => Math.abs(b.varianceUsd ?? 0) - Math.abs(a.varianceUsd ?? 0))
  return (
    <>
      {t && (
        <div className="card mb-4">
          <div className="text-sm text-stone-600">
            Approved by {count.approvedByName}, {when(count.approvedAt)}. {t.counted} items counted, {t.differences} different.
          </div>
          <div className={`mt-1 text-2xl font-semibold ${t.netUsd < 0 ? 'text-red-700' : 'text-bean-900'}`}>
            {t.netUsd < 0 ? 'Missing ' : 'Net '}
            {formatUsd(Math.abs(t.netUsd))} <span className="text-sm font-normal text-stone-400">{formatKhr(Math.abs(t.netUsd), settings.usdToKhr)}</span>
          </div>
          <div className="text-xs text-stone-400">Missing {formatUsd(t.lossUsd)} · found extra {formatUsd(t.gainUsd)}</div>
        </div>
      )}
      {diffs.length === 0 ? (
        <Empty>Everything matched. Well done.</Empty>
      ) : (
        <div className="card p-0">
          <ul className="divide-y divide-stone-100">
            {diffs.map((l) => (
              <li key={l.itemId} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {l.itemName}
                  <span className="ml-2 text-xs text-stone-400">
                    {formatQty(l.expected, l.baseUnit)} → {formatQty(l.counted ?? 0, l.baseUnit)}
                  </span>
                </span>
                <span className={(l.variance ?? 0) < 0 ? 'text-red-700' : 'text-green-700'}>
                  {(l.variance ?? 0) > 0 ? '+' : ''}
                  {formatQty(l.variance ?? 0, l.baseUnit)} · {signedUsd(l.varianceUsd ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
