import { useMemo, useState, type ReactNode } from 'react'
import { limit, orderBy, where, type QueryConstraint } from 'firebase/firestore'
import { COL } from '../lib/collections'
import { useCollection, useSettings } from '../lib/data'
import { useProfile } from '../lib/auth'
import { useBranch } from '../lib/branch'
import { isAdmin } from '../lib/permissions'
import { buildReport, periodRange, shopDayStart, addDays, toCsv, type PeriodKey } from '../lib/reports'
import { shopToday } from '../lib/sales'
import { WASTE_REASONS, type Item, type Movement, type Sale, type StockLevel } from '../lib/types'
import { formatKhr, formatQty, formatUsd } from '../lib/units'
import { Empty, PageHeader } from '../components/ui'
import { stockRows } from './Stock'
import { t } from '../lib/i18n'

// Phase 6: reports. Everything is added up from the movement ledger and the sales
// records for the chosen days. Nothing is stored twice, so a report can never
// disagree with the stock history.

const MAX_ROWS = 5000
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: t('Today') },
  { key: 'yesterday', label: t('Yesterday') },
  { key: '7d', label: t('Last 7 days') },
  { key: 'month', label: t('This month') },
  { key: 'lastMonth', label: t('Last month') },
  { key: 'custom', label: t('Choose days') },
]
const reasonLabel = (r: string) => WASTE_REASONS.find((w) => w.value === r)?.label ?? r
const signedUsd = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${formatUsd(Math.abs(v))}`
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '')

/** Download text as a file the person can open in Excel. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Reports() {
  const me = useProfile()
  const settings = useSettings()
  const { current, branches } = useBranch()
  const today = shopToday()
  const [period, setPeriod] = useState<PeriodKey>('7d')
  const [custom, setCustom] = useState(() => periodRange('7d', today))
  const [scope, setScope] = useState<'branch' | 'all'>('branch')
  const range = period === 'custom' ? custom : periodRange(period, today)
  const all = scope === 'all' && isAdmin(me)
  const branchId = current?.id ?? ''

  const start = shopDayStart(range.from)
  const end = shopDayStart(addDays(range.to, 1))
  const valid = range.from <= range.to
  const key = `${all ? 'all' : branchId}|${range.from}|${range.to}`
  const moveQ: QueryConstraint[] = [
    ...(all ? [] : [where('branchId', '==', branchId)]),
    where('createdAt', '>=', start),
    where('createdAt', '<', end),
    orderBy('createdAt'),
    limit(MAX_ROWS),
  ]
  const saleQ: QueryConstraint[] = [
    ...(all ? [] : [where('branchId', '==', branchId)]),
    where('date', '>=', range.from),
    where('date', '<=', range.to),
    limit(MAX_ROWS),
  ]
  const moves = useCollection<Movement>(COL.movements, moveQ, `m|${key}`, !current || !valid)
  const sales = useCollection<Sale>(COL.sales, saleQ, `s|${key}`, !current || !valid)
  const report = useMemo(() => buildReport(moves.rows, sales.rows), [moves.rows, sales.rows])

  if (!current) return <Empty>{t('Choose a branch first.')}</Empty>
  const where_ = all ? t('All branches') : current.name
  const file = (what: string) => `grove-stock-${what}-${all ? 'all' : current.code}-${range.from}-to-${range.to}.csv`
  const loading = moves.loading || sales.loading
  const r = report

  return (
    <>
      <PageHeader title={t('Reports · {where_}', { where_ })} subtitle={range.from === range.to ? range.from : t('{from} to {to}', { from: range.from, to: range.to })} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {PERIODS.map((p) => (
          <button key={p.key} className={period === p.key ? 'btn' : 'btn-ghost'} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
        {isAdmin(me) && branches.length > 1 && (
          <select className="input ml-auto w-auto" aria-label={t('Which branches')} value={scope} onChange={(e) => setScope(e.target.value as 'branch' | 'all')}>
            <option value="branch">{current.name}{' '}{t('only')}</option>
            <option value="all">{t('All branches')}</option>
          </select>
        )}
      </div>
      {period === 'custom' && (
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="block">
            <span className="label">{t('From')}</span>
            <input className="input" type="date" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          </label>
          <label className="block">
            <span className="label">{t('To')}</span>
            <input className="input" type="date" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </label>
          {!valid && <p className="self-end text-sm text-red-700">{t('"From" must be before "To".')}</p>}
        </div>
      )}
      {(moves.error || sales.error) && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{moves.error || sales.error}</div>}
      {(moves.rows.length >= MAX_ROWS || sales.rows.length >= MAX_ROWS) && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('Too much data for one report. Choose fewer days so the totals are complete.')}</div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={t('Sales')} value={formatUsd(r.salesUsd)} note={t('{cups} sold{v}', { cups: r.cups, v: r.salesWithoutPrice ? ' · ' + t('{n} without price', { n: r.salesWithoutPrice }) : '' })} />
        <Stat
          label={t('Cost of ingredients')}
          value={formatUsd(r.costOfSalesUsd)}
          note={r.costPct === null ? t('What the drinks sold used') : t('{costPct}% of sales', { costPct: r.costPct })}
          tone={r.costPct !== null && r.costPct > 35 ? 'bad' : undefined}
        />
        <Stat label={t('Waste')} value={formatUsd(r.wasteUsd)} note={r.salesUsd ? t('{pct} of sales', { pct: pct(r.wasteUsd, r.salesUsd) }) : t('Thrown away')} tone={r.wasteUsd > 0 ? 'warn' : undefined} />
        <Stat label={t('Count differences')} value={signedUsd(r.varianceUsd)} note={r.varianceUsd < 0 ? t('Missing at counts') : t('From stock counts')} tone={r.varianceUsd < 0 ? 'bad' : undefined} />
        <Stat label={t('Bought')} value={formatUsd(r.receivedUsd)} note={formatKhr(r.receivedUsd, settings.usdToKhr)} />
      </div>

      {loading ? (
        <Empty>{t('Loading…')}</Empty>
      ) : moves.rows.length === 0 && sales.rows.length === 0 ? (
        <Empty>{t('Nothing happened in these days.')}</Empty>
      ) : (
        <>
          <Section
            title={t('By day')}
            onExport={() =>
              download(
                file('by-day'),
                toCsv(
                  [t('Day'), t('Sales USD'), t('Cost of ingredients USD'), t('Cost %'), t('Waste USD'), t('Count differences USD'), t('Bought USD')],
                  r.days.map((d) => [d.day, d.salesUsd, d.costOfSalesUsd, d.salesUsd ? Math.round((d.costOfSalesUsd / d.salesUsd) * 1000) / 10 : '', d.wasteUsd, d.varianceUsd, d.receivedUsd]),
                ),
              )
            }
          >
            <DayChart days={r.days} />
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-2">{t('Day')}</th>
                  <th className="py-2 text-right">{t('Sales')}</th>
                  <th className="py-2 text-right">{t('Ingredients')}</th>
                  <th className="hidden py-2 text-right sm:table-cell">{t('Cost %')}</th>
                  <th className="py-2 text-right">{t('Waste')}</th>
                  <th className="hidden py-2 text-right sm:table-cell">{t('Counts')}</th>
                  <th className="hidden py-2 text-right sm:table-cell">{t('Bought')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {r.days.map((d) => (
                  <tr key={d.day}>
                    <td className="py-2">{d.day}</td>
                    <td className="py-2 text-right">{formatUsd(d.salesUsd)}</td>
                    <td className="py-2 text-right">{formatUsd(d.costOfSalesUsd)}</td>
                    <td className="hidden py-2 text-right text-stone-500 sm:table-cell">{pct(d.costOfSalesUsd, d.salesUsd)}</td>
                    <td className="py-2 text-right">{d.wasteUsd ? formatUsd(d.wasteUsd) : ''}</td>
                    <td className={`hidden py-2 text-right sm:table-cell ${d.varianceUsd < 0 ? 'text-red-700' : ''}`}>{d.varianceUsd ? signedUsd(d.varianceUsd) : ''}</td>
                    <td className="hidden py-2 text-right sm:table-cell">{d.receivedUsd ? formatUsd(d.receivedUsd) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title={t('By item')}
            subtitle={t('Used = taken out by sales. Count differences: minus means missing.')}
            onExport={() =>
              download(
                file('by-item'),
                toCsv(
                  [t('Item'), t('Unit'), t('Used qty'), t('Used USD'), t('Wasted qty'), t('Wasted USD'), t('Count difference qty'), t('Count difference USD'), t('Received qty'), t('Received USD')],
                  r.items.map((i) => [i.itemName, i.baseUnit, i.usedQty, i.usedUsd, i.wastedQty, i.wastedUsd, i.varianceQty, i.varianceUsd, i.receivedQty, i.receivedUsd]),
                ),
              )
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-2">{t('Item')}</th>
                    <th className="py-2 text-right">{t('Used')}</th>
                    <th className="py-2 text-right">{t('Wasted')}</th>
                    <th className="py-2 text-right">{t('Counts')}</th>
                    <th className="hidden py-2 text-right sm:table-cell">{t('Received')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {r.items.map((i) => (
                    <tr key={i.itemId}>
                      <td className="py-2">{i.itemName}</td>
                      <td className="py-2 text-right">
                        {i.usedQty ? (
                          <>
                            {formatUsd(i.usedUsd)} <span className="block text-xs text-stone-400">{formatQty(i.usedQty, i.baseUnit)}</span>
                          </>
                        ) : ''}
                      </td>
                      <td className="py-2 text-right">
                        {i.wastedQty ? (
                          <>
                            {formatUsd(i.wastedUsd)} <span className="block text-xs text-stone-400">{formatQty(i.wastedQty, i.baseUnit)}</span>
                          </>
                        ) : ''}
                      </td>
                      <td className={`py-2 text-right ${i.varianceUsd < 0 ? 'text-red-700' : ''}`}>
                        {i.varianceQty ? (
                          <>
                            {signedUsd(i.varianceUsd)} <span className="block text-xs text-stone-400">{formatQty(i.varianceQty, i.baseUnit)}</span>
                          </>
                        ) : ''}
                      </td>
                      <td className="hidden py-2 text-right sm:table-cell">{i.receivedQty ? formatUsd(i.receivedUsd) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {r.wasteByReason.length > 0 && (
            <Section title={t('Waste by reason')}>
              <ul className="space-y-2 text-sm">
                {r.wasteByReason.map((w) => (
                  <li key={w.reason}>
                    <div className="flex justify-between">
                      <span>{reasonLabel(w.reason)}</span>
                      <span>{formatUsd(w.usd)} <span className="text-stone-400">· {pct(w.usd, r.wasteUsd)}</span></span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-stone-100">
                      <div className="h-2 rounded-full bg-amber-500" style={{ width: `${r.wasteUsd ? (w.usd / r.wasteUsd) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {r.adjustUsd !== 0 && (
            <p className="mb-5 text-xs text-stone-500">{t('Manual adjustments in these days:')}{' '}{signedUsd(r.adjustUsd)}{' '}{t('(not in the totals above).')}</p>
          )}
        </>
      )}
      <StockValue />
    </>
  )
}

/** Stock value now, per branch (owners and admins see every branch; others their own). */
function StockValue() {
  const me = useProfile()
  const settings = useSettings()
  const { current, branches } = useBranch()
  const ids = isAdmin(me) ? branches.map((b) => b.id) : current ? [current.id] : []
  const items = useCollection<Item>(COL.items, [orderBy('name')])
  const levels = useCollection<StockLevel>(COL.stock, [where('branchId', 'in', ids.slice(0, 30))], ids.join(','), ids.length === 0)
  const rows = useMemo(
    () =>
      branches
        .filter((b) => ids.includes(b.id))
        .map((b) => {
          const list = stockRows(items.rows, levels.rows.filter((l) => l.branchId === b.id))
          return {
            branch: b,
            valueUsd: Math.round(list.reduce((s, x) => s + x.valueUsd, 0) * 100) / 100,
            low: list.filter((x) => x.status !== 'ok').length,
            negative: list.filter((x) => x.qty < 0).length,
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branches, items.rows, levels.rows, ids.join(',')],
  )
  const total = rows.reduce((s, x) => s + x.valueUsd, 0)
  return (
    <Section
      title={t('Stock value now')}
      subtitle={t('What the stock on the shelves cost, at average cost.')}
      onExport={() =>
        download(
          `grove-stock-value-${shopToday()}.csv`,
          toCsv([t('Branch'), t('Code'), t('Stock value USD'), t('Stock value KHR'), t('Items low or out'), t('Items below zero')], rows.map((x) => [x.branch.name, x.branch.code, x.valueUsd, Math.round(x.valueUsd * settings.usdToKhr), x.low, x.negative])),
        )
      }
    >
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="py-2">{t('Branch')}</th>
            <th className="py-2 text-right">{t('Value')}</th>
            <th className="py-2 text-right">{t('Low or out')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((x) => (
            <tr key={x.branch.id}>
              <td className="py-2">{x.branch.name}</td>
              <td className="py-2 text-right">
                {formatUsd(x.valueUsd)} <span className="block text-xs text-stone-400">{formatKhr(x.valueUsd, settings.usdToKhr)}</span>
              </td>
              <td className="py-2 text-right">
                {x.low}
                {x.negative > 0 && <span className="block text-xs text-red-700">{x.negative}{' '}{t('below zero')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="border-t border-stone-200 font-semibold">
              <td className="py-2">{t('Total')}</td>
              <td className="py-2 text-right">{formatUsd(total)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </Section>
  )
}

/** Sales and ingredient cost per day as simple bars: the gap between them is what is left to pay rent and wages. */
function DayChart({ days }: { days: { day: string; salesUsd: number; costOfSalesUsd: number; wasteUsd: number }[] }) {
  if (days.length < 2) return null
  const max = Math.max(...days.map((d) => Math.max(d.salesUsd, d.costOfSalesUsd + d.wasteUsd)), 1)
  return (
    <div className="mb-4">
      <div className="flex h-40 items-end gap-1" role="img" aria-label={t('Sales and ingredient cost per day')}>
        {days.map((d) => (
          <div key={d.day} className="flex h-full flex-1 items-end gap-0.5" title={t('{day}: sales {usd}, ingredients {usd2}, waste {usd3}', { day: d.day, usd: formatUsd(d.salesUsd), usd2: formatUsd(d.costOfSalesUsd), usd3: formatUsd(d.wasteUsd) })}>
            <div className="flex-1 rounded-t bg-bean-500" style={{ height: `${(d.salesUsd / max) * 100}%` }} />
            <div className="flex flex-1 flex-col justify-end" style={{ height: `${((d.costOfSalesUsd + d.wasteUsd) / max) * 100}%` }}>
              <div className="rounded-t bg-amber-500" style={{ height: `${d.costOfSalesUsd + d.wasteUsd ? (d.wasteUsd / (d.costOfSalesUsd + d.wasteUsd)) * 100 : 0}%` }} />
              <div className="flex-1 bg-bean-100" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-stone-400">
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-stone-600">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-bean-500" />{' '}{t('Sales')}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-bean-100" />{' '}{t('Ingredients used')}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-amber-500" />{' '}{t('Waste')}</span>
      </div>
    </div>
  )
}

function Section({ title, subtitle, onExport, children }: { title: string; subtitle?: string; onExport?: () => void; children: ReactNode }) {
  return (
    <div className="card mb-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-bean-900">{title}</h2>
          {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
        </div>
        {onExport && (
          <button className="btn-ghost text-sm" onClick={onExport}>
            {t('Download for Excel')}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' | 'warn' }) {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-bean-900'
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      {note && <div className="text-xs text-stone-400">{note}</div>}
    </div>
  )
}
