// Phase 7a: helpers for daily orders from a branch to the main warehouse (ស្តុកធំ).
// Branches order in PACKS (cartons, bags), the way the stock keeper hands them out.
import type { RequestStatus } from './types'

/**
 * How many packs to ask for so the branch is back to its full level.
 * Full level = the item's "refill to" (par) level; if none is set, twice its "low" level.
 * Returns 0 when the branch already has enough (or no levels are set).
 */
export function suggestPacks(onHand: number, parLevel: number, reorderPoint: number, unitsPerPurchase: number): number {
  const target = parLevel > 0 ? parLevel : reorderPoint > 0 ? reorderPoint * 2 : 0
  const need = target - Math.max(onHand, 0)
  if (need <= 0) return 0
  return Math.ceil(need / (unitsPerPurchase > 1 ? unitsPerPurchase : 1))
}

/** "2.5" packs of 1000 ml -> 2500 ml. Blank -> 0. Bad -> NaN. */
export function packsToBase(packs: string, unitsPerPurchase: number): number {
  const s = packs.trim().replace(',', '.')
  if (s === '') return 0
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return NaN
  return Math.round(n * (unitsPerPurchase > 1 ? unitsPerPurchase : 1) * 10000) / 10000
}

/** 2500 ml in packs of 1000 -> "2.5" (for the stock keeper's boxes). */
export function baseToPacks(qty: number, unitsPerPurchase: number): string {
  const v = qty / (unitsPerPurchase > 1 ? unitsPerPurchase : 1)
  return String(Math.round(v * 100) / 100)
}

/** Still waiting for the warehouse? */
export const isWaiting = (s: RequestStatus) => s === 'requested'

/** All waiting orders added up per item: what the stock keeper must pick today. */
export function pickList(requests: { status: RequestStatus; lines: { itemId: string; itemName: string; qty: number; baseUnit: string }[] }[]) {
  const m = new Map<string, { itemId: string; itemName: string; baseUnit: string; qty: number; orders: number }>()
  for (const r of requests) {
    if (!isWaiting(r.status)) continue
    for (const l of r.lines) {
      const cur = m.get(l.itemId) ?? { itemId: l.itemId, itemName: l.itemName, baseUnit: l.baseUnit, qty: 0, orders: 0 }
      cur.qty = Math.round((cur.qty + l.qty) * 10000) / 10000
      cur.orders++
      m.set(l.itemId, cur)
    }
  }
  return [...m.values()].sort((a, b) => a.itemName.localeCompare(b.itemName))
}
