// Phase 6: report maths. Pure functions (no database), so they are easy to test.
//
// Every number here comes from the movement ledger (inv_movements) and the sales
// records (inv_sales). That is the pay-off of "never type stock in directly":
// because every change is a row with a type and a value, a report is just adding up rows.
import type { BaseUnit } from './units'
import type { Movement, Sale } from './types'

export interface ItemLine {
  itemId: string
  itemName: string
  baseUnit: BaseUnit
  /** Used by sales (net of cancelled sales), in base units and USD. */
  usedQty: number
  usedUsd: number
  wastedQty: number
  wastedUsd: number
  /** Stock count differences: negative = missing. */
  varianceQty: number
  varianceUsd: number
  receivedQty: number
  receivedUsd: number
}

export interface DayLine {
  day: string
  salesUsd: number
  costOfSalesUsd: number
  wasteUsd: number
  varianceUsd: number
  receivedUsd: number
}

export interface Report {
  salesUsd: number
  /** Sales with no price on some line: revenue unknown for these. */
  salesWithoutPrice: number
  cups: number
  /** Cost of goods sold: what the ingredients used by sales cost. */
  costOfSalesUsd: number
  /** costOfSales / sales, in %, or null with no sales. */
  costPct: number | null
  wasteUsd: number
  wasteByReason: { reason: string; usd: number }[]
  /** Net of all count differences (negative = missing). */
  varianceUsd: number
  adjustUsd: number
  receivedUsd: number
  items: ItemLine[]
  days: DayLine[]
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r4 = (v: number) => Math.round(v * 10000) / 10000

/** The shop day (Cambodia, UTC+7) of a moment, as YYYY-MM-DD. */
export function shopDay(d: Date): string {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/** Start of a shop day as a real moment: 2026-11-25 00:00 in Cambodia = 2026-11-24 17:00 UTC. */
export function shopDayStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 3600 * 1000)
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

export type PeriodKey = 'today' | 'yesterday' | '7d' | 'month' | 'lastMonth' | 'custom'

/** First and last shop day (both included) of a named period. */
export function periodRange(key: Exclude<PeriodKey, 'custom'>, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 7)}-01`
  switch (key) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case 'month':
      return { from: monthStart, to: today }
    case 'lastMonth': {
      const end = addDays(monthStart, -1)
      return { from: `${end.slice(0, 7)}-01`, to: end }
    }
  }
}

export function buildReport(movements: Movement[], sales: Sale[]): Report {
  const items = new Map<string, ItemLine>()
  const days = new Map<string, DayLine>()
  const reasons = new Map<string, number>()
  const item = (m: Movement) => {
    let l = items.get(m.itemId)
    if (!l) {
      l = { itemId: m.itemId, itemName: m.itemName, baseUnit: m.baseUnit, usedQty: 0, usedUsd: 0, wastedQty: 0, wastedUsd: 0, varianceQty: 0, varianceUsd: 0, receivedQty: 0, receivedUsd: 0 }
      items.set(m.itemId, l)
    }
    return l
  }
  const dayOf = (day: string) => {
    let d = days.get(day)
    if (!d) {
      d = { day, salesUsd: 0, costOfSalesUsd: 0, wasteUsd: 0, varianceUsd: 0, receivedUsd: 0 }
      days.set(day, d)
    }
    return d
  }
  let adjustUsd = 0
  for (const m of movements) {
    const day = m.createdAt ? dayOf(shopDay(m.createdAt.toDate())) : null
    const v = m.valueUsd ?? 0
    switch (m.type) {
      case 'sale':
      case 'sale_void': {
        const l = item(m)
        l.usedQty -= m.qtyChange
        l.usedUsd -= v
        if (day) day.costOfSalesUsd -= v
        break
      }
      case 'waste': {
        const l = item(m)
        l.wastedQty -= m.qtyChange
        l.wastedUsd -= v
        if (day) day.wasteUsd -= v
        const reason = m.reason || 'other'
        reasons.set(reason, (reasons.get(reason) ?? 0) - v)
        break
      }
      case 'count': {
        const l = item(m)
        l.varianceQty += m.qtyChange
        l.varianceUsd += v
        if (day) day.varianceUsd += v
        break
      }
      case 'receive': {
        const l = item(m)
        l.receivedQty += m.qtyChange
        l.receivedUsd += v
        if (day) day.receivedUsd += v
        break
      }
      case 'adjust':
        adjustUsd += v
        break
      // transfers move stock between branches: not a cost of the business, so not added here
    }
  }

  let salesUsd = 0
  let cups = 0
  let salesWithoutPrice = 0
  for (const s of sales) {
    if (s.status !== 'done') continue
    cups += s.cups ?? 0
    if (typeof s.salesUsd === 'number') {
      salesUsd += s.salesUsd
      dayOf(s.date).salesUsd += s.salesUsd
    } else salesWithoutPrice++
  }

  const itemList = [...items.values()]
    .map((l) => ({
      ...l,
      usedQty: r4(l.usedQty),
      usedUsd: r2(l.usedUsd),
      wastedQty: r4(l.wastedQty),
      wastedUsd: r2(l.wastedUsd),
      varianceQty: r4(l.varianceQty),
      varianceUsd: r2(l.varianceUsd),
      receivedQty: r4(l.receivedQty),
      receivedUsd: r2(l.receivedUsd),
    }))
    .sort((a, b) => b.usedUsd + b.wastedUsd - Math.min(b.varianceUsd, 0) - (a.usedUsd + a.wastedUsd - Math.min(a.varianceUsd, 0)) || a.itemName.localeCompare(b.itemName))
  const costOfSalesUsd = r2(itemList.reduce((s, l) => s + l.usedUsd, 0))
  return {
    salesUsd: r2(salesUsd),
    salesWithoutPrice,
    cups: r2(cups),
    costOfSalesUsd,
    costPct: salesUsd > 0 ? Math.round((costOfSalesUsd / salesUsd) * 1000) / 10 : null,
    wasteUsd: r2(itemList.reduce((s, l) => s + l.wastedUsd, 0)),
    wasteByReason: [...reasons.entries()].map(([reason, usd]) => ({ reason, usd: r2(usd) })).sort((a, b) => b.usd - a.usd),
    varianceUsd: r2(itemList.reduce((s, l) => s + l.varianceUsd, 0)),
    adjustUsd: r2(adjustUsd),
    receivedUsd: r2(itemList.reduce((s, l) => s + l.receivedUsd, 0)),
    items: itemList,
    days: [...days.values()]
      .map((d) => ({ day: d.day, salesUsd: r2(d.salesUsd), costOfSalesUsd: r2(d.costOfSalesUsd), wasteUsd: r2(d.wasteUsd), varianceUsd: r2(d.varianceUsd), receivedUsd: r2(d.receivedUsd) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  }
}

/** One CSV cell: quote it when it has a comma, quote or new line. */
function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV text that Excel opens directly. The "\uFEFF" at the start (a BOM) tells Excel the file
 * is UTF-8, so Khmer text and the riel sign show correctly.
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
