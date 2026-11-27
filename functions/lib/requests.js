// Daily orders from a branch to the main warehouse (ស្តុកធំ). Pure logic only
// (no database), so it is easy to test (functions/test/requests.test.js).
//
// How a daily order works:
// 1. A branch writes what it needs from the main warehouse ("requested").
// 2. The stock keeper at the warehouse checks it, changes a number if there is not
//    enough, and presses Send. That makes a normal TRANSFER from the warehouse to the
//    branch, so stock leaves the warehouse at once ("sent").
// 3. The branch confirms what arrived on the Transfers page, like any transfer ("received").
// Before it is sent, the branch can cancel it, or the warehouse can refuse it ("rejected").

export const REQUEST_STATUS = ['requested', 'sent', 'received', 'rejected', 'cancelled']
export const MAX_REQUEST_LINES = 200
const MAX_QTY = 10_000_000
const ID = /^[A-Za-z0-9_-]{1,64}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d

/** REQ-0001, REQ-0002, ... */
export const requestNumber = (n) => `REQ-${String(n).padStart(4, '0')}`

/**
 * Check a new daily order typed at a branch. Quantities are in base units (g, ml, pcs).
 * @returns {{error:string} | {value:{branchId:string, warehouseId:string, neededDate:string, note:string, lines:{itemId:string, qty:number}[]}}}
 */
export function checkRequestInput(raw) {
  const d = raw ?? {}
  if (typeof d.branchId !== 'string' || !ID.test(d.branchId)) return { error: 'Choose a branch.' }
  if (typeof d.warehouseId !== 'string' || !ID.test(d.warehouseId)) return { error: 'Choose the main warehouse.' }
  if (d.branchId === d.warehouseId) return { error: 'A warehouse cannot order from itself.' }
  if (typeof d.neededDate !== 'string' || !DATE.test(d.neededDate)) return { error: 'The date must look like 2026-12-31.' }
  const note = typeof d.note === 'string' ? d.note.trim().slice(0, 300) : ''
  if (!Array.isArray(d.lines) || d.lines.length === 0) return { error: 'Add at least one item.' }
  if (d.lines.length > MAX_REQUEST_LINES) return { error: `Too many lines (max ${MAX_REQUEST_LINES}).` }
  const seen = new Set()
  const lines = []
  for (const l of d.lines) {
    if (!l || typeof l.itemId !== 'string' || !ID.test(l.itemId)) return { error: 'Choose an item on every line.' }
    if (seen.has(l.itemId)) return { error: 'The same item is on the list twice.' }
    seen.add(l.itemId)
    const qty = Number(l.qty)
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'Every line needs a quantity more than 0.' }
    if (qty > MAX_QTY) return { error: 'A quantity is too big. Check the number.' }
    lines.push({ itemId: l.itemId, qty: round(qty) })
  }
  return { value: { branchId: d.branchId, warehouseId: d.warehouseId, neededDate: d.neededDate, note, lines } }
}

/**
 * The stock keeper's numbers to send: { itemId: qty in base units }. A missing item = send what was asked.
 * 0 = do not send that item. The warehouse may send more than asked (e.g. a full carton).
 * @returns {{error:string} | {lines: object[], send: {itemId:string, qty:number}[]}}
 */
export function checkSendQty(requestLines, raw) {
  const got = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const known = new Set(requestLines.map((l) => l.itemId))
  for (const k of Object.keys(got)) if (!known.has(k)) return { error: 'An item is not on this order.' }
  const lines = []
  for (const l of requestLines) {
    const q = got[l.itemId] === undefined || got[l.itemId] === null || got[l.itemId] === '' ? l.qty : Number(got[l.itemId])
    if (!Number.isFinite(q) || q < 0) return { error: `${l.itemName}: send 0 or more.` }
    if (q > MAX_QTY) return { error: `${l.itemName}: the number is too big.` }
    lines.push({ ...l, sentQty: round(q) })
  }
  const send = lines.filter((l) => l.sentQty > 0).map((l) => ({ itemId: l.itemId, qty: l.sentQty }))
  if (send.length === 0) return { error: 'Nothing to send. To say no to this order, use Reject.' }
  return { lines, send }
}

/** Who may do what to an order, and from which status. */
export const REQUEST_ACTIONS = {
  // the branch takes it back before the warehouse sends it
  cancel: { from: ['requested'], side: 'branch' },
  // the warehouse says no (with a reason)
  reject: { from: ['requested'], side: 'warehouse' },
}
