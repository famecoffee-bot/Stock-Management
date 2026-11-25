// The stock maths, kept free of Firebase so it can be tested on its own
// (functions/test/stock.test.js). Every quantity is in the item's base unit.

export const MOVEMENT_TYPES = ['receive', 'waste', 'adjust', 'transfer_out', 'transfer_in', 'sale', 'sale_void']
export const WASTE_REASONS = ['expired', 'spilled', 'damaged', 'staff_drink', 'quality', 'other']

/** Who may record which kind of movement at a branch. */
export const NEEDS = {
  receive: 'staff',
  waste: 'staff',
  adjust: 'manager',
  transfer_out: 'staff',
  transfer_in: 'staff',
}

const RANK = { viewer: 1, staff: 2, manager: 3 }

/** Same rule as the app and the Firestore rules: admins everywhere, members by branch. */
export function canAt(profile, branchId, need) {
  if (!profile || profile.active !== true) return false
  if (profile.role === 'owner' || profile.role === 'admin') return true
  const has = profile.branchRoles?.[branchId]
  return !!has && RANK[has] >= RANK[need]
}

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d

/**
 * Apply one change to one item's stock at one branch.
 * @param {{qty:number, avgCostUsd:number}|undefined} current stock now (undefined = never stocked)
 * @param {number} qtyChange + adds, - removes
 * @param {number|undefined} unitCostUsd cost of ONE base unit, only used when adding on receive / transfer in
 * @param {{allowNegative?: boolean}} opts
 * @returns {{error:string} | {qtyBefore:number, qtyAfter:number, avgCostUsd:number, valueUsd:number}}
 */
export function applyChange(current, qtyChange, unitCostUsd, opts = {}) {
  if (typeof qtyChange !== 'number' || !Number.isFinite(qtyChange) || qtyChange === 0) {
    return { error: 'Quantity must be a number other than 0.' }
  }
  const qtyBefore = current?.qty ?? 0
  const oldAvg = current?.avgCostUsd ?? 0
  const qtyAfter = round(qtyBefore + qtyChange)
  // Only taking stock OUT can be refused. Putting stock back (a delivery, a
  // cancelled sale) is always allowed, even if the count is still below zero.
  if (qtyChange < 0 && qtyAfter < 0 && !opts.allowNegative) {
    return { error: `Not enough stock: only ${round(qtyBefore, 2)} left.` }
  }

  // Weighted average cost: when new stock arrives at a different price, the
  // average moves toward the new price in proportion to how much arrived.
  let avgCostUsd = oldAvg
  if (qtyChange > 0 && typeof unitCostUsd === 'number' && unitCostUsd >= 0) {
    const base = Math.max(qtyBefore, 0)
    avgCostUsd = base + qtyChange > 0 ? (base * oldAvg + qtyChange * unitCostUsd) / (base + qtyChange) : unitCostUsd
  }
  const costForValue = qtyChange > 0 && typeof unitCostUsd === 'number' ? unitCostUsd : oldAvg
  return {
    qtyBefore,
    qtyAfter,
    avgCostUsd: round(avgCostUsd, 6),
    valueUsd: round(qtyChange * costForValue, 4),
  }
}

/**
 * Check and clean the lines a person sent for receive / waste / adjust.
 * @returns {{error:string} | {lines: Array<{itemId:string, qty:number, unitCostUsd?:number, expiryDate?:string, reason?:string}>}}
 */
export function checkLines(type, raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Add at least one item.' }
  if (raw.length > 100) return { error: 'Too many lines (max 100).' }
  const seen = new Set()
  const lines = []
  for (const l of raw) {
    const itemId = typeof l?.itemId === 'string' ? l.itemId : ''
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) return { error: 'Unknown item.' }
    if (seen.has(itemId)) return { error: 'The same item is listed twice. Put it on one line.' }
    seen.add(itemId)
    const qty = Number(l.qty)
    if (!Number.isFinite(qty) || qty === 0) return { error: 'Every line needs a quantity.' }
    if (type !== 'adjust' && qty < 0) return { error: 'Quantities must be positive.' }
    const line = { itemId, qty }
    if (type === 'receive') {
      const c = Number(l.unitCostUsd)
      if (!Number.isFinite(c) || c < 0) return { error: 'Every received line needs a cost (0 or more).' }
      line.unitCostUsd = c
      if (l.expiryDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(l.expiryDate)) return { error: 'Expiry date must look like 2026-12-31.' }
        line.expiryDate = l.expiryDate
      }
    }
    if (type === 'waste') {
      if (!WASTE_REASONS.includes(l.reason)) return { error: 'Choose a reason for the waste.' }
      line.reason = l.reason
    }
    if (type === 'adjust') {
      const reason = typeof l.reason === 'string' ? l.reason.trim() : ''
      if (!reason) return { error: 'Write why you are adjusting.' }
      line.reason = reason.slice(0, 200)
    }
    lines.push(line)
  }
  return { lines }
}

/** Signed change for a movement type: waste and transfers out remove stock. */
export function signedQty(type, qty) {
  return type === 'waste' || type === 'transfer_out' || type === 'sale' ? -Math.abs(qty) : type === 'adjust' ? qty : Math.abs(qty)
}
