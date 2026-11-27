// Daily orders: a branch asks the main warehouse (ស្តុកធំ) for stock, and the
// warehouse sends it as a normal transfer. See lib/requests.js for the steps.
// Each function runs in one Firestore transaction in the stock app's own "stock" database.
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { REQUEST_ACTIONS, checkRequestInput, checkSendQty, requestNumber } from './lib/requests.js'
import { ledger } from './stock-api.js'

const C = { requests: 'inv_requests', counters: 'inv_counters', branches: 'inv_branches' }

export function requestsApi(db) {
  const { profileOf, need, activeBranch, readItems, cleanNote, sendTransferTx } = ledger(db)

  async function readRequest(tx, id) {
    if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Missing order.')
    const ref = db.collection(C.requests).doc(id)
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
    return { ref, r: snap.data() }
  }

  /** A branch writes what it needs from the main warehouse. */
  const invCreateRequest = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const checked = checkRequestInput(req.data)
    if (checked.error) throw new HttpsError('invalid-argument', checked.error)
    const { branchId, warehouseId, neededDate, note, lines } = checked.value
    need(me, branchId, 'staff')
    const ref = db.collection(C.requests).doc()
    const counterRef = db.collection(C.counters).doc('requests')

    return db.runTransaction(async (tx) => {
      const branch = await activeBranch(tx, branchId)
      const wh = await activeBranch(tx, warehouseId)
      if (wh.kind !== 'warehouse') throw new HttpsError('failed-precondition', 'Daily orders go to a main warehouse. Mark it as a warehouse on the Branches page.')
      const items = await readItems(tx, lines.map((l) => l.itemId))
      const counter = await tx.get(counterRef)
      for (const l of lines) {
        if (items[l.itemId].active !== true) throw new HttpsError('failed-precondition', `${items[l.itemId].name} is stopped and cannot be ordered.`)
      }
      const n = (counter.exists ? counter.data().next : 1) || 1
      tx.set(counterRef, { next: n + 1 }, { merge: true })
      tx.set(ref, {
        number: requestNumber(n),
        branchId,
        branchName: branch.name,
        warehouseId,
        warehouseName: wh.name,
        neededDate,
        status: 'requested',
        note: note || null,
        lines: lines.map((l) => {
          const i = items[l.itemId]
          return {
            itemId: l.itemId,
            itemName: i.name,
            category: i.category || 'Other',
            baseUnit: i.baseUnit,
            purchaseUnit: i.purchaseUnit || '',
            unitsPerPurchase: i.unitsPerPurchase || 1,
            qty: l.qty,
            sentQty: null,
          }
        }),
        transferId: null,
        createdBy: me.uid,
        createdByName: me.name,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, id: ref.id, number: requestNumber(n) }
    })
  })

  /** The stock keeper sends the order (numbers may be changed). Makes a transfer to the branch. */
  const invSendRequest = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const note = cleanNote(req.data?.note)
    return db.runTransaction(async (tx) => {
      const { ref, r } = await readRequest(tx, req.data?.id)
      need(me, r.warehouseId, 'staff')
      if (r.status !== 'requested') throw new HttpsError('failed-precondition', 'This order was already sent or closed.')
      const checked = checkSendQty(r.lines, req.data?.send)
      if (checked.error) throw new HttpsError('invalid-argument', checked.error)
      const from = await activeBranch(tx, r.warehouseId)
      const to = await activeBranch(tx, r.branchId)
      const transferId = await sendTransferTx(tx, {
        me,
        fromBranchId: r.warehouseId,
        from,
        toBranchId: r.branchId,
        to,
        lines: checked.send,
        note: [r.number, note].filter(Boolean).join(' · '),
        extra: { requestId: ref.id, requestNumber: r.number },
      })
      const changed = checked.lines.some((l) => l.sentQty !== l.qty)
      tx.update(ref, {
        status: 'sent',
        lines: checked.lines,
        changed,
        sendNote: note || null,
        transferId,
        sentBy: me.uid,
        sentByName: me.name,
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, transferId, changed }
    })
  })

  /** Cancel (the branch) or reject (the warehouse) an order that was not sent yet. Stock is not touched. */
  const invRequestAction = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const action = REQUEST_ACTIONS[req.data?.action]
    if (!action) throw new HttpsError('invalid-argument', 'Unknown action.')
    const reason = cleanNote(req.data?.reason)
    if (req.data.action === 'reject' && !reason) throw new HttpsError('invalid-argument', 'Write why you reject this order.')
    return db.runTransaction(async (tx) => {
      const { ref, r } = await readRequest(tx, req.data?.id)
      need(me, action.side === 'branch' ? r.branchId : r.warehouseId, 'staff')
      if (!action.from.includes(r.status)) throw new HttpsError('failed-precondition', 'This order was already sent or closed.')
      const status = req.data.action === 'cancel' ? 'cancelled' : 'rejected'
      tx.update(ref, {
        status,
        closeReason: reason || null,
        closedBy: me.uid,
        closedByName: me.name,
        closedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, status }
    })
  })

  return { invCreateRequest, invSendRequest, invRequestAction }
}
