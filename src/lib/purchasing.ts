import type { Item, PoLine, PoStatus, PurchaseOrder, StockLevel } from './types'
import { formatKhr, formatQty, formatUsd } from './units'
import { t } from './i18n'

// Purchase-order helpers for the screens. The server (functions/lib/purchasing.js)
// checks everything again; these only make the screens quick and friendly.

/** Which buttons a manager sees for each status (same table as the server's PO_ACTIONS). */
export const PO_ACTIONS_FOR: Record<PoStatus, ('send' | 'cancel' | 'close' | 'reopen')[]> = {
  draft: ['send', 'cancel'],
  sent: ['reopen', 'cancel'],
  partial: ['close'],
  received: [],
  cancelled: [],
}

export const isOpen = (s: PoStatus) => s === 'sent' || s === 'partial'

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d

/** Packs still to come on one line. */
export const remainingPacks = (l: PoLine) => round(Math.max(l.packs - (l.receivedPacks ?? 0), 0))

export interface Suggestion {
  item: Item
  /** On hand now, base units. */
  onHand: number
  /** Packs to order. */
  packs: number
}

/**
 * "What should I order from this supplier?" For each item they sell that is at or
 * below its reorder point: order enough packs to get back up to the par level
 * (or, with no par level set, to twice the reorder point).
 */
export function suggestOrder(items: Item[], levels: StockLevel[]): Suggestion[] {
  const byItem = new Map(levels.map((l) => [l.itemId, l]))
  const out: Suggestion[] = []
  for (const item of items) {
    if (!item.active || !(item.unitsPerPurchase > 0)) continue
    const lvl = byItem.get(item.id)
    const onHand = lvl?.qty ?? 0
    const reorder = lvl ? lvl.reorderPoint : item.defaultReorderPoint
    if (!(reorder > 0) || onHand > reorder) continue
    const par = lvl && lvl.parLevel > reorder ? lvl.parLevel : reorder * 2
    const need = par - Math.max(onHand, 0)
    const packs = Math.max(1, Math.ceil(round(need / item.unitsPerPurchase)))
    out.push({ item, onHand, packs })
  }
  return out
}

/** Total of order lines in USD. */
export const linesTotal = (lines: { packs: number; packCostUsd: number }[]) =>
  round(lines.reduce((s, l) => s + (Number(l.packs) || 0) * (Number(l.packCostUsd) || 0), 0), 2)

/** The order as a plain message to paste into Telegram or SMS for the supplier. */
export function orderText(po: PurchaseOrder, usdToKhr: number): string {
  const lines = po.lines.map(
    (l, i) => `${i + 1}. ${l.itemName}: ${l.packs} × ${l.purchaseUnit} @ ${formatUsd(l.packCostUsd)} = ${formatUsd(l.packs * l.packCostUsd)}`,
  )
  return [
    t('Grove Coffee · Order {number}', { number: po.number }),
    t('Deliver to: {branch}', { branch: po.branchName }),
    po.expectedDate ? t('Needed by: {date}', { date: po.expectedDate }) : null,
    '',
    ...lines,
    '',
    t('Total: {usd} ({khr})', { usd: formatUsd(po.totalUsd), khr: formatKhr(po.totalUsd, usdToKhr) }),
    po.note ? t('Note: {note}', { note: po.note }) : null,
    t('Thank you!'),
  ]
    .filter((x) => x !== null)
    .join('\n')
}

/** "3 bags (3 kg)" for a line. */
export function packsLabel(packs: number, l: Pick<PoLine, 'purchaseUnit' | 'unitsPerPurchase' | 'baseUnit'>) {
  return `${round(packs, 2)} × ${l.purchaseUnit} (${formatQty(packs * l.unitsPerPurchase, l.baseUnit)})`
}
