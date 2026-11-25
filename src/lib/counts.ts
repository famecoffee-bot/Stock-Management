// Phase 5: helpers for the count sheet. People count in the way they see the shelf:
// "3 full cartons and an open one with about 400 ml". The app turns that into base units.
import type { CountLine } from './types'

export interface CountEntry {
  packs: string
  loose: string
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')))

/** Packs + loose to base units. Blank in both = not counted (null). Bad numbers = NaN. */
export function entryToBase(e: CountEntry, unitsPerPurchase: number): number | null {
  const packs = num(e.packs)
  const loose = num(e.loose)
  if (packs === null && loose === null) return null
  const total = (packs ?? 0) * (unitsPerPurchase > 1 ? unitsPerPurchase : 1) + (loose ?? 0)
  if (!Number.isFinite(total) || (packs ?? 0) < 0 || (loose ?? 0) < 0) return NaN
  return Math.round(total * 10000) / 10000
}

/** Show a saved count again in the two boxes: whole packs + the rest. */
export function baseToEntry(qty: number | null, unitsPerPurchase: number): CountEntry {
  if (qty === null) return { packs: '', loose: '' }
  if (!(unitsPerPurchase > 1)) return { packs: '', loose: String(qty) }
  const packs = Math.floor(qty / unitsPerPurchase)
  const loose = Math.round((qty - packs * unitsPerPurchase) * 10000) / 10000
  return { packs: packs ? String(packs) : '', loose: loose ? String(loose) : packs ? '' : '0' }
}

/** Is a difference big enough to check again before approving? More than 10% and worth more than $1. */
export function bigDifference(l: Pick<CountLine, 'expected' | 'counted' | 'avgCostUsd'>): boolean {
  if (l.counted === null) return false
  const diff = l.counted - l.expected
  const pct = l.expected === 0 ? (diff === 0 ? 0 : 1) : Math.abs(diff) / Math.abs(l.expected)
  return pct > 0.1 && Math.abs(diff * l.avgCostUsd) > 1
}

/** The same sums the server does on approval, shown on screen before the manager approves. */
export function previewTotals(lines: CountLine[]) {
  let counted = 0
  let differences = 0
  let lossUsd = 0
  let gainUsd = 0
  for (const l of lines) {
    if (l.counted === null) continue
    counted++
    const d = l.counted - l.expected
    if (d !== 0) differences++
    const v = d * l.avgCostUsd
    if (v < 0) lossUsd -= v
    else gainUsd += v
  }
  const r2 = (v: number) => Math.round(v * 100) / 100
  return { counted, differences, lossUsd: r2(lossUsd), gainUsd: r2(gainUsd), netUsd: r2(gainUsd - lossUsd) }
}
