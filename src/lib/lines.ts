import type { ChangeLine, ChangeType } from './api'
import type { Item } from './types'
import { t } from './i18n'

// What a person types on the Receive / Waste / Adjust screens, and how it turns
// into the base-unit numbers the server stores. Kept separate so it can be tested.

export interface DraftLine {
  key: string
  itemId: string
  /** How many, in the unit chosen by `inPacks`. */
  qty: string
  /** true = counting in purchase units (bags, cartons); false = base units (g, ml, pcs). */
  inPacks: boolean
  /** Receive: USD for ONE purchase unit (what is on the supplier's invoice). */
  packCostUsd: string
  expiryDate: string
  reason: string
  /** Adjust: the real amount on the shelf now, in the chosen unit. */
  actual: string
}

let n = 0
export const newDraft = (): DraftLine => ({
  key: `l${++n}`,
  itemId: '',
  qty: '',
  inPacks: true,
  packCostUsd: '',
  expiryDate: '',
  reason: '',
  actual: '',
})

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

/**
 * @param currentQty stock on hand now (base units), needed for "adjust"
 * @returns the line to send, or an error sentence
 */
export function toChangeLine(type: ChangeType, d: DraftLine, item: Item | undefined, currentQty = 0): ChangeLine | { error: string } {
  if (!item) return { error: t('Choose an item on every line.') }
  const per = d.inPacks ? item.unitsPerPurchase : 1

  if (type === 'adjust') {
    const actual = num(d.actual)
    if (!Number.isFinite(actual) || actual < 0) return { error: t('{name}: enter the real amount (0 or more).', { name: item.name }) }
    const qty = round(actual * per - currentQty)
    if (qty === 0) return { error: t('{name}: the amount is already {currentQty} {baseUnit}, nothing to change.', { name: item.name, currentQty, baseUnit: item.baseUnit }) }
    if (!d.reason.trim()) return { error: t('{name}: write why you are adjusting.', { name: item.name }) }
    return { itemId: item.id, qty, reason: d.reason.trim() }
  }

  const q = num(d.qty)
  if (!Number.isFinite(q) || q <= 0) return { error: t('{name}: enter a quantity more than 0.', { name: item.name }) }
  const qty = round(q * per)

  if (type === 'receive') {
    const packCost = num(d.packCostUsd)
    if (!Number.isFinite(packCost) || packCost < 0) return { error: t('{name}: enter the cost (0 if free).', { name: item.name }) }
    if (item.perishable && !d.expiryDate) return { error: t('{name}: enter the expiry date.', { name: item.name }) }
    const line: ChangeLine = { itemId: item.id, qty, unitCostUsd: packCost / item.unitsPerPurchase }
    if (d.expiryDate) line.expiryDate = d.expiryDate
    return line
  }

  if (!d.reason) return { error: t('{name}: choose a reason.', { name: item.name }) }
  return { itemId: item.id, qty, reason: d.reason }
}

function round(v: number) {
  return Math.round(v * 10000) / 10000
}
