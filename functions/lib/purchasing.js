// Purchase order rules, kept free of Firebase so they can be tested on their own
// (functions/test/purchasing.test.js).
//
// A purchase order (PO) counts in PACKS: the unit the supplier sells (bag 1 kg,
// carton 1 L). When it is received, packs are turned into base units (g, ml, pcs)
// for the stock ledger, exactly like the normal Receive screen.

/** What can happen to a PO, and from which status. */
export const PO_STATUS = ['draft', 'sent', 'partial', 'received', 'cancelled']
export const PO_ACTIONS = {
  send: { from: ['draft'], to: 'sent' },
  cancel: { from: ['draft', 'sent'], to: 'cancelled' },
  // stop waiting for the rest: what arrived stays, the PO is closed as "received (short)"
  close: { from: ['partial'], to: 'received' },
  // back to draft to fix a mistake, only if nothing was received yet
  reopen: { from: ['sent'], to: 'draft' },
}

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d
const ID = /^[A-Za-z0-9_-]{1,64}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Check what a manager typed for a PO (create or edit a draft).
 * @returns {{error:string} | {value:{supplierId:string, branchId:string, expectedDate:string|null, note:string, lines:Array<{itemId:string, packs:number, packCostUsd:number}>}}}
 */
export function checkPoInput(raw) {
  const d = raw ?? {}
  if (typeof d.supplierId !== 'string' || !ID.test(d.supplierId)) return { error: 'Choose a supplier.' }
  if (typeof d.branchId !== 'string' || !ID.test(d.branchId)) return { error: 'Choose a branch.' }
  let expectedDate = null
  if (d.expectedDate) {
    if (typeof d.expectedDate !== 'string' || !DATE.test(d.expectedDate)) return { error: 'Delivery date must look like 2026-12-31.' }
    expectedDate = d.expectedDate
  }
  const note = typeof d.note === 'string' ? d.note.trim().slice(0, 300) : ''
  if (!Array.isArray(d.lines) || d.lines.length === 0) return { error: 'Add at least one item.' }
  if (d.lines.length > 100) return { error: 'Too many lines (max 100).' }
  const seen = new Set()
  const lines = []
  for (const l of d.lines) {
    const itemId = typeof l?.itemId === 'string' ? l.itemId : ''
    if (!ID.test(itemId)) return { error: 'Unknown item.' }
    if (seen.has(itemId)) return { error: 'The same item is listed twice. Put it on one line.' }
    seen.add(itemId)
    const packs = Number(l.packs)
    if (!Number.isFinite(packs) || packs <= 0) return { error: 'Every line needs a quantity more than 0.' }
    const packCostUsd = Number(l.packCostUsd)
    if (!Number.isFinite(packCostUsd) || packCostUsd < 0) return { error: 'Every line needs a price (0 or more).' }
    lines.push({ itemId, packs: round(packs), packCostUsd: round(packCostUsd) })
  }
  return { value: { supplierId: d.supplierId, branchId: d.branchId, expectedDate, note, lines } }
}

/** Total of a PO in USD (what was ordered). */
export function poTotal(lines) {
  return round(lines.reduce((s, l) => s + l.packs * l.packCostUsd, 0), 2)
}

/** Packs still to come on one line. */
export const remainingPacks = (line) => round(Math.max(line.packs - (line.receivedPacks ?? 0), 0))

/** "PO-0007" from a counter number. */
export const poNumber = (n) => `PO-${String(n).padStart(4, '0')}`

/**
 * Check one delivery against a PO and work out the new PO lines.
 * A delivery may be less than ordered (more comes later) or a little more
 * (suppliers sometimes add one). More than double the remaining is refused as a typo.
 * @param po the PO document
 * @param raw [{itemId, packs, packCostUsd?, expiryDate?}]
 * @param items {itemId: item} for perishable checks
 * @returns {{error:string} | {receive:Array<{itemId,packs,packCostUsd,expiryDate?}>, lines:Array, status:'partial'|'received', short:boolean}}
 */
export function planPoReceipt(po, raw, items = {}) {
  if (!['sent', 'partial'].includes(po.status)) return { error: 'Only an order that was sent can be received.' }
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Enter what arrived.' }
  const byId = new Map(po.lines.map((l) => [l.itemId, l]))
  const got = new Map()
  for (const r of raw) {
    const line = byId.get(r?.itemId)
    if (!line) return { error: 'An item is not on this order.' }
    if (got.has(r.itemId)) return { error: 'The same item is listed twice.' }
    const packs = Number(r.packs)
    if (!Number.isFinite(packs) || packs < 0) return { error: `${line.itemName}: quantity must be 0 or more.` }
    if (packs === 0) continue
    const left = remainingPacks(line)
    if (packs > Math.max(left * 2, left + 1)) return { error: `${line.itemName}: ${packs} is much more than the ${left} still expected. Check the number.` }
    const packCostUsd = r.packCostUsd === undefined || r.packCostUsd === '' ? line.packCostUsd : Number(r.packCostUsd)
    if (!Number.isFinite(packCostUsd) || packCostUsd < 0) return { error: `${line.itemName}: price must be 0 or more.` }
    let expiryDate
    if (r.expiryDate) {
      if (!DATE.test(r.expiryDate)) return { error: 'Expiry date must look like 2026-12-31.' }
      expiryDate = r.expiryDate
    } else if (items[r.itemId]?.perishable) {
      return { error: `${line.itemName}: enter the expiry date.` }
    }
    got.set(r.itemId, { itemId: r.itemId, packs: round(packs), packCostUsd: round(packCostUsd), ...(expiryDate ? { expiryDate } : {}) })
  }
  if (got.size === 0) return { error: 'Nothing arrived? Enter at least one quantity.' }
  const lines = po.lines.map((l) => {
    const g = got.get(l.itemId)
    return g ? { ...l, receivedPacks: round((l.receivedPacks ?? 0) + g.packs), receivedCostUsd: g.packCostUsd } : l
  })
  const complete = lines.every((l) => remainingPacks(l) === 0)
  return { receive: [...got.values()], lines, status: complete ? 'received' : 'partial', short: false }
}
