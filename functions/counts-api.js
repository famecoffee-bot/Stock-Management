// Phase 5: stock counts (stock takes). See lib/counts.js for how a count works.
// Starting, saving and approving each run in one Firestore transaction, and the
// approved differences go through the same ledger as every other stock change.
// Everything is in the stock app's own "stock" database.
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { checkCountEntries, countResult } from './lib/counts.js'
import { ledger } from './stock-api.js'

const C = { counts: 'inv_counts', items: 'inv_items' }
const OPEN = ['open', 'submitted']
const MAX_LINES = 400

export function countsApi(db) {
  const { profileOf, need, activeBranch, readItems, readStock, plan, write, cleanNote } = ledger(db)

  async function readCount(tx, id) {
    if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Missing count.')
    const ref = db.collection(C.counts).doc(id)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'Count not found.')
    return { ref, count: snap.data() }
  }

  /** Start a count at a branch: write down what the app expects for every active item (or one category). */
  const invStartCount = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { branchId } = req.data ?? {}
    const category = typeof req.data?.category === 'string' && req.data.category ? req.data.category.slice(0, 60) : null
    need(me, branchId, 'staff')
    const ref = db.collection(C.counts).doc()

    return db.runTransaction(async (tx) => {
      await activeBranch(tx, branchId)
      const busy = await tx.get(db.collection(C.counts).where('branchId', '==', branchId).where('status', 'in', OPEN).limit(1))
      if (!busy.empty) throw new HttpsError('failed-precondition', 'A count is already open at this branch. Finish or cancel it first.')
      const itemSnap = await tx.get(db.collection(C.items).where('active', '==', true))
      const items = itemSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => !category || i.category === category)
      if (items.length === 0) throw new HttpsError('failed-precondition', 'No items to count.')
      if (items.length > MAX_LINES) throw new HttpsError('failed-precondition', `Too many items for one count (max ${MAX_LINES}). Count one category at a time.`)
      const stock = await readStock(tx, branchId, items.map((i) => i.id))
      items.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name))
      const lines = items.map((i) => ({
        itemId: i.id,
        itemName: i.name,
        category: i.category || 'Other',
        baseUnit: i.baseUnit,
        purchaseUnit: i.purchaseUnit || '',
        unitsPerPurchase: i.unitsPerPurchase || 1,
        expected: stock[i.id]?.qty ?? 0,
        avgCostUsd: stock[i.id]?.avgCostUsd ?? 0,
        counted: null,
      }))
      tx.set(ref, {
        branchId,
        status: 'open',
        category,
        note: cleanNote(req.data?.note) || null,
        lines,
        createdBy: me.uid,
        createdByName: me.name,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, id: ref.id }
    })
  })

  /** Save what was counted. With submit: true, hand it to a manager to approve. */
  const invSaveCount = onCall(async (req) => {
    const me = await profileOf(req.auth)
    return db.runTransaction(async (tx) => {
      const { ref, count } = await readCount(tx, req.data?.id)
      need(me, count.branchId, 'staff')
      if (count.status === 'submitted') need(me, count.branchId, 'manager')
      else if (count.status !== 'open') throw new HttpsError('failed-precondition', 'This count is already closed.')
      const checked = checkCountEntries(req.data.counted ?? {}, count.lines.map((l) => l.itemId))
      if (checked.error) throw new HttpsError('invalid-argument', checked.error)
      const lines = count.lines.map((l) => (l.itemId in checked.value ? { ...l, counted: checked.value[l.itemId] } : l))
      const done = lines.filter((l) => l.counted !== null).length
      const update = { lines, updatedAt: FieldValue.serverTimestamp() }
      if (req.data.submit === true) {
        if (done === 0) throw new HttpsError('failed-precondition', 'Count at least one item first.')
        Object.assign(update, { status: 'submitted', submittedBy: me.uid, submittedByName: me.name, submittedAt: FieldValue.serverTimestamp() })
      }
      tx.update(ref, update)
      return { ok: true, counted: done, total: lines.length }
    })
  })

  /** A manager approves: every difference becomes a "count" movement and stock matches the shelf. */
  const invApproveCount = onCall(async (req) => {
    const me = await profileOf(req.auth)
    return db.runTransaction(async (tx) => {
      const { ref, count } = await readCount(tx, req.data?.id)
      need(me, count.branchId, 'manager')
      if (!OPEN.includes(count.status)) throw new HttpsError('failed-precondition', 'This count is already closed.')
      await activeBranch(tx, count.branchId)
      const result = countResult(count.lines)
      if (result.totals.counted === 0) throw new HttpsError('failed-precondition', 'Nothing was counted yet.')
      const changes = result.lines.filter((l) => l.variance)
      if (changes.length) {
        const ids = changes.map((l) => l.itemId)
        const items = await readItems(tx, ids)
        const stock = await readStock(tx, count.branchId, ids)
        // Extra stock found is valued at today's average cost, so the average does not move.
        // allowNegative: a count is the truth, even if sales since the start take it below zero.
        const planned = plan(
          changes.map((l) => ({ itemId: l.itemId, qty: l.variance, unitCostUsd: stock[l.itemId]?.avgCostUsd ?? l.avgCostUsd ?? 0, reason: 'Stock count' })),
          'count',
          stock,
          items,
          { allowNegative: true },
        )
        write(tx, { branchId: count.branchId, type: 'count', planned, items, stock, me, note: 'Stock count', refType: 'count', refId: ref.id })
      }
      tx.update(ref, {
        status: 'approved',
        lines: result.lines,
        totals: result.totals,
        approvedBy: me.uid,
        approvedByName: me.name,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, ...result.totals }
    })
  })

  /** Cancel a count: a manager always; the person who started it while it is still open. Stock is not touched. */
  const invCancelCount = onCall(async (req) => {
    const me = await profileOf(req.auth)
    return db.runTransaction(async (tx) => {
      const { ref, count } = await readCount(tx, req.data?.id)
      if (!OPEN.includes(count.status)) throw new HttpsError('failed-precondition', 'This count is already closed.')
      const own = count.createdBy === me.uid && count.status === 'open'
      if (!own) need(me, count.branchId, 'manager')
      else need(me, count.branchId, 'staff')
      tx.update(ref, { status: 'cancelled', cancelledBy: me.uid, cancelledByName: me.name, updatedAt: FieldValue.serverTimestamp() })
      return { ok: true }
    })
  })

  return { invStartCount, invSaveCount, invApproveCount, invCancelCount }
}

export { MAX_LINES }
