// Phase 5: which lots are still on the shelf, and when they expire.
//
// The app does not ask staff which lot they used for every latte. Instead it assumes
// the good habit: use the oldest-expiring lot first ("first expired, first out").
// Then whatever is still in stock must be the LATEST-expiring lots. So we take the
// stock on hand and fill it from the newest lot backwards. Any lot that is left with
// some quantity is what is on the shelf now.
import type { Batch } from './types'

export interface Lot {
  batch: Batch
  /** How much of this lot is (probably) still on the shelf, in base units. */
  qtyLeft: number
  daysLeft: number
}

export interface ItemLots {
  lots: Lot[]
  /** Stock that no received lot explains (e.g. came by transfer): expiry unknown. */
  unknownQty: number
}

/** Whole days from today to an expiry date (both YYYY-MM-DD). 0 = expires today, -1 = expired yesterday. */
export function daysUntil(expiryDate: string, today: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  const b = Date.UTC(+expiryDate.slice(0, 4), +expiryDate.slice(5, 7) - 1, +expiryDate.slice(8, 10))
  return Math.round((b - a) / 86400000)
}

/** Share the stock on hand over the lots, newest expiry first. */
export function lotsOnShelf(qtyOnHand: number, batches: Batch[], today: string): ItemLots {
  let rest = Math.max(qtyOnHand, 0)
  const lots: Lot[] = []
  const newestFirst = [...batches].sort((a, b) => b.expiryDate.localeCompare(a.expiryDate))
  for (const batch of newestFirst) {
    if (rest <= 0) break
    const qtyLeft = Math.min(batch.qtyReceived, rest)
    rest -= qtyLeft
    lots.push({ batch, qtyLeft: Math.round(qtyLeft * 10000) / 10000, daysLeft: daysUntil(batch.expiryDate, today) })
  }
  lots.sort((a, b) => a.daysLeft - b.daysLeft)
  return { lots, unknownQty: Math.round(rest * 10000) / 10000 }
}

export type ExpiryLevel = 'expired' | 'today' | 'soon' | 'ok'

/** expired: past its date. today: use today or tomorrow. soon: within 3 days. */
export function expiryLevel(daysLeft: number): ExpiryLevel {
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 1) return 'today'
  if (daysLeft <= 3) return 'soon'
  return 'ok'
}
