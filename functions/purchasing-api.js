// Phase 3: purchase orders. A manager writes an order to a supplier, sends it,
// and when the goods arrive staff receive them AGAINST the order. Receiving uses
// the very same ledger code as the normal Receive screen (stock-api.js), so stock,
// movements and expiry batches stay consistent. Everything is in the "stock" database.
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { PO_ACTIONS, checkPoInput, planPoReceipt, poNumber, poTotal } from './lib/purchasing.js'
import { ledger } from './stock-api.js'

const C = { suppliers: 'inv_suppliers', pos: 'inv_purchase_orders', counters: 'inv_counters', items: 'inv_items' }
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d

export function purchasingApi(db) {
  const { profileOf, need, activeBranch, readItems, readStock, plan, write, cleanNote } = ledger(db)

  /** Create a new PO (no id) or change a draft (with id). Managers of the branch only. */
  const invSavePurchaseOrder = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const checked = checkPoInput(req.data)
    if (checked.error) throw new HttpsError('invalid-argument', checked.error)
    const input = checked.value
    need(me, input.branchId, 'manager')
    const id = typeof req.data?.id === 'string' && req.data.id ? req.data.id : null
    const ref = id ? db.collection(C.pos).doc(id) : db.collection(C.pos).doc()
    const counterRef = db.collection(C.counters).doc('purchaseOrders')

    return db.runTransaction(async (tx) => {
      // 1. read everything first (Firestore transactions need all reads before writes)
      let old = null
      if (id) {
        const snap = await tx.get(ref)
        if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
        old = snap.data()
        if (old.status !== 'draft') throw new HttpsError('failed-precondition', 'Only a draft can be changed. Move it back to draft first.')
        need(me, old.branchId, 'manager')
      }
      const branch = await activeBranch(tx, input.branchId)
      const sup = await tx.get(db.collection(C.suppliers).doc(input.supplierId))
      if (!sup.exists || sup.data().active !== true) throw new HttpsError('failed-precondition', 'This supplier is stopped or missing.')
      const items = await readItems(tx, input.lines.map((l) => l.itemId))
      const counter = id ? null : await tx.get(counterRef)

      // 2. build the order; item details are copied in, so the order still reads right if the item changes later
      const lines = input.lines.map((l) => {
        const it = items[l.itemId]
        if (it.active !== true && !old?.lines.some((o) => o.itemId === l.itemId)) {
          throw new HttpsError('failed-precondition', `${it.name} is stopped and cannot be ordered.`)
        }
        return {
          itemId: l.itemId,
          itemName: it.name,
          baseUnit: it.baseUnit,
          purchaseUnit: it.purchaseUnit || it.baseUnit,
          unitsPerPurchase: it.unitsPerPurchase,
          packs: l.packs,
          packCostUsd: l.packCostUsd,
          receivedPacks: 0,
        }
      })
      const data = {
        branchId: input.branchId,
        branchName: branch.name,
        supplierId: input.supplierId,
        supplierName: sup.data().name,
        lines,
        totalUsd: poTotal(lines),
        expectedDate: input.expectedDate,
        note: input.note || null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: me.uid,
      }

      // 3. write
      if (old) {
        tx.update(ref, data)
        return { ok: true, id: ref.id, number: old.number }
      }
      const n = (counter.exists ? counter.data().next : 1) || 1
      tx.set(counterRef, { next: n + 1 }, { merge: true })
      tx.set(ref, {
        ...data,
        number: poNumber(n),
        status: 'draft',
        short: false,
        receipts: [],
        log: [{ status: 'draft', byName: me.name, at: Timestamp.now() }],
        createdBy: me.uid,
        createdByName: me.name,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, id: ref.id, number: poNumber(n) }
    })
  })

  /** Send, cancel, close (stop waiting for the rest) or reopen a PO. Managers only. */
  const invPurchaseOrderAction = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { id, action } = req.data ?? {}
    const rule = PO_ACTIONS[action]
    if (!rule) throw new HttpsError('invalid-argument', 'Unknown action.')
    if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Missing order.')
    const ref = db.collection(C.pos).doc(id)
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
      const po = snap.data()
      need(me, po.branchId, 'manager')
      if (!rule.from.includes(po.status)) {
        throw new HttpsError('failed-precondition', `A ${po.status} order cannot be ${action === 'send' ? 'sent' : action + 'd'}.`)
      }
      const patch = {
        status: rule.to,
        log: FieldValue.arrayUnion({ status: rule.to, action, byName: me.name, at: Timestamp.now() }),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: me.uid,
      }
      if (action === 'send') patch.sentAt = FieldValue.serverTimestamp()
      if (action === 'close') patch.short = true
      tx.update(ref, patch)
      return { ok: true, status: rule.to }
    })
  })

  /**
   * Staff record what arrived for a PO. Stock goes up through the normal ledger
   * (type "receive", linked to the PO), and the PO remembers how much came.
   */
  const invReceivePurchaseOrder = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { id } = req.data ?? {}
    if (typeof id !== 'string' || !id) throw new HttpsError('invalid-argument', 'Missing order.')
    const note = cleanNote(req.data.note)
    const ref = db.collection(C.pos).doc(id)

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
      const po = snap.data()
      need(me, po.branchId, 'staff')
      await activeBranch(tx, po.branchId)
      const ids = po.lines.map((l) => l.itemId)
      const items = await readItems(tx, ids)
      const r = planPoReceipt(po, req.data.lines, items)
      if (r.error) throw new HttpsError('invalid-argument', r.error)
      const stock = await readStock(tx, po.branchId, r.receive.map((l) => l.itemId))

      // packs -> base units, using the pack size written on the order
      const lineOf = new Map(po.lines.map((l) => [l.itemId, l]))
      const baseLines = r.receive.map((g) => {
        const per = lineOf.get(g.itemId).unitsPerPurchase
        return { itemId: g.itemId, qty: round(g.packs * per), unitCostUsd: g.packCostUsd / per, ...(g.expiryDate ? { expiryDate: g.expiryDate } : {}) }
      })
      const planned = plan(baseLines, 'receive', stock, items)
      write(tx, {
        branchId: po.branchId,
        type: 'receive',
        planned,
        items,
        stock,
        me,
        note: [`${po.number} · ${po.supplierName}`, note].filter(Boolean).join(' · '),
        refType: 'po',
        refId: id,
      })
      // remember the latest price per purchase unit on each item (as the Receive screen does)
      for (const p of planned) {
        tx.update(db.collection(C.items).doc(p.itemId), {
          lastCostUsd: round(p.unitCostUsd * items[p.itemId].unitsPerPurchase),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      tx.update(ref, {
        lines: r.lines,
        status: r.status,
        receipts: FieldValue.arrayUnion({
          at: Timestamp.now(),
          byName: me.name,
          note: note || null,
          lines: r.receive.map((g) => ({ itemId: g.itemId, packs: g.packs, packCostUsd: g.packCostUsd })),
        }),
        log: FieldValue.arrayUnion({ status: r.status, action: 'receive', byName: me.name, at: Timestamp.now() }),
        receivedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: me.uid,
      })
      return { ok: true, status: r.status }
    })
  })

  return { invSavePurchaseOrder, invPurchaseOrderAction, invReceivePurchaseOrder }
}
