// Phase 2: every change to stock goes through these functions. Each one runs in
// a Firestore transaction: it reads the current stock, checks it, then writes
// the new stock AND a movement row together, so the two can never disagree.
// All reads and writes are in the stock app's own "stock" database.
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { NEEDS, applyChange, canAt, checkLines, signedQty } from './lib/stock.js'

const C = {
  users: 'inv_users',
  branches: 'inv_branches',
  items: 'inv_items',
  stock: 'inv_stock',
  movements: 'inv_movements',
  batches: 'inv_batches',
  transfers: 'inv_transfers',
}
const stockId = (branchId, itemId) => `${branchId}_${itemId}`

export function stockApi(db) {
  async function profileOf(auth) {
    if (!auth) throw new HttpsError('unauthenticated', 'Please sign in.')
    const me = (await db.collection(C.users).doc(auth.uid).get()).data()
    if (!me || me.active !== true) throw new HttpsError('permission-denied', 'You do not have access.')
    return { ...me, uid: auth.uid }
  }
  function need(me, branchId, level) {
    if (!canAt(me, branchId, level)) throw new HttpsError('permission-denied', `You need ${level} rights at this branch.`)
  }
  async function activeBranch(tx, branchId) {
    if (typeof branchId !== 'string' || !branchId) throw new HttpsError('invalid-argument', 'Choose a branch.')
    const b = await tx.get(db.collection(C.branches).doc(branchId))
    if (!b.exists || b.data().active !== true) throw new HttpsError('failed-precondition', 'This branch is closed or missing.')
    return b.data()
  }
  async function readItems(tx, ids) {
    const snaps = await tx.getAll(...ids.map((id) => db.collection(C.items).doc(id)))
    const items = {}
    for (const s of snaps) {
      if (!s.exists) throw new HttpsError('not-found', 'An item on the list does not exist.')
      items[s.id] = s.data()
    }
    return items
  }
  async function readStock(tx, branchId, ids) {
    const snaps = await tx.getAll(...ids.map((id) => db.collection(C.stock).doc(stockId(branchId, id))))
    return Object.fromEntries(snaps.map((s, i) => [ids[i], s.exists ? s.data() : undefined]))
  }

  /** Work out every change first (no writes yet), so one bad line stops the whole batch. */
  function plan(lines, type, stock, items, opts = {}) {
    return lines.map((l) => {
      const qtyChange = signedQty(type, l.qty)
      const r = applyChange(stock[l.itemId], qtyChange, l.unitCostUsd, opts)
      if (r.error) throw new HttpsError('failed-precondition', `${items[l.itemId].name}: ${r.error}`)
      return { ...l, qtyChange, ...r }
    })
  }

  /** Write the new stock numbers and one movement row per line. */
  function write(tx, { branchId, type, planned, items, stock, me, note, refType, refId }) {
    const now = FieldValue.serverTimestamp()
    for (const p of planned) {
      const item = items[p.itemId]
      tx.set(
        db.collection(C.stock).doc(stockId(branchId, p.itemId)),
        {
          branchId,
          itemId: p.itemId,
          itemName: item.name,
          baseUnit: item.baseUnit,
          qty: p.qtyAfter,
          avgCostUsd: p.avgCostUsd,
          reorderPoint: stock[p.itemId]?.reorderPoint ?? item.defaultReorderPoint ?? 0,
          parLevel: stock[p.itemId]?.parLevel ?? 0,
          updatedAt: now,
        },
        { merge: true },
      )
      tx.set(db.collection(C.movements).doc(), {
        branchId,
        itemId: p.itemId,
        itemName: item.name,
        baseUnit: item.baseUnit,
        type,
        qtyChange: p.qtyChange,
        qtyBefore: p.qtyBefore,
        qtyAfter: p.qtyAfter,
        unitCostUsd: p.qtyChange > 0 && p.unitCostUsd !== undefined ? p.unitCostUsd : stock[p.itemId]?.avgCostUsd ?? 0,
        valueUsd: p.valueUsd,
        reason: p.reason ?? null,
        expiryDate: p.expiryDate ?? null,
        note: note || null,
        refType: refType ?? null,
        refId: refId ?? null,
        userId: me.uid,
        userName: me.name,
        createdAt: now,
      })
      if (type === 'receive' && item.perishable && p.expiryDate) {
        tx.set(db.collection(C.batches).doc(), {
          branchId,
          itemId: p.itemId,
          itemName: item.name,
          qtyReceived: p.qtyChange,
          qtyLeft: p.qtyChange,
          expiryDate: p.expiryDate,
          receivedAt: now,
          refId: refId ?? null,
        })
      }
    }
  }

  const cleanNote = (n) => (typeof n === 'string' ? n.trim().slice(0, 300) : '')

  /** Receive, waste or adjust at one branch. */
  const invRecordMovement = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { branchId, type } = req.data ?? {}
    if (!['receive', 'waste', 'adjust'].includes(type)) throw new HttpsError('invalid-argument', 'Unknown kind of change.')
    need(me, branchId, NEEDS[type])
    const checked = checkLines(type, req.data.lines)
    if (checked.error) throw new HttpsError('invalid-argument', checked.error)
    const ids = checked.lines.map((l) => l.itemId)
    const note = cleanNote(req.data.note)

    return db.runTransaction(async (tx) => {
      await activeBranch(tx, branchId)
      const items = await readItems(tx, ids)
      const stock = await readStock(tx, branchId, ids)
      // A manager's adjustment may take stock below zero to match a real count; nothing else may.
      const planned = plan(checked.lines, type, stock, items, { allowNegative: type === 'adjust' })
      write(tx, { branchId, type, planned, items, stock, me, note })
      if (type === 'receive') {
        // remember the latest price per purchase unit on the item
        for (const p of planned) {
          const item = items[p.itemId]
          tx.update(db.collection(C.items).doc(p.itemId), {
            lastCostUsd: Math.round(p.unitCostUsd * item.unitsPerPurchase * 10000) / 10000,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }
      return { ok: true, lines: planned.length }
    })
  })

  /** Send stock from one branch to another. Stock leaves the sender at once. */
  const invSendTransfer = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { fromBranchId, toBranchId } = req.data ?? {}
    if (fromBranchId === toBranchId) throw new HttpsError('invalid-argument', 'Choose two different branches.')
    need(me, fromBranchId, 'staff')
    const checked = checkLines('transfer_out', req.data.lines)
    if (checked.error) throw new HttpsError('invalid-argument', checked.error)
    const ids = checked.lines.map((l) => l.itemId)
    const note = cleanNote(req.data.note)
    const ref = db.collection(C.transfers).doc()

    return db.runTransaction(async (tx) => {
      const from = await activeBranch(tx, fromBranchId)
      const to = await activeBranch(tx, toBranchId)
      const items = await readItems(tx, ids)
      const stock = await readStock(tx, fromBranchId, ids)
      const planned = plan(checked.lines, 'transfer_out', stock, items)
      write(tx, { branchId: fromBranchId, type: 'transfer_out', planned, items, stock, me, note, refType: 'transfer', refId: ref.id })
      tx.set(ref, {
        fromBranchId,
        fromName: from.name,
        toBranchId,
        toName: to.name,
        status: 'sent',
        lines: planned.map((p) => ({
          itemId: p.itemId,
          itemName: items[p.itemId].name,
          baseUnit: items[p.itemId].baseUnit,
          qty: p.qty,
          unitCostUsd: stock[p.itemId]?.avgCostUsd ?? 0,
          receivedQty: null,
        })),
        note: note || null,
        sentBy: me.uid,
        sentByName: me.name,
        sentAt: FieldValue.serverTimestamp(),
        // both branch ids in one list, so "transfers touching my branch" is one query
        branchIds: [fromBranchId, toBranchId],
      })
      return { ok: true, id: ref.id }
    })
  })

  /** The receiving branch confirms what actually arrived. */
  const invReceiveTransfer = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { transferId, received } = req.data ?? {}
    if (typeof transferId !== 'string' || !transferId) throw new HttpsError('invalid-argument', 'Missing transfer.')
    const ref = db.collection(C.transfers).doc(transferId)

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw new HttpsError('not-found', 'Transfer not found.')
      const t = snap.data()
      if (t.status !== 'sent') throw new HttpsError('failed-precondition', 'This transfer is already closed.')
      need(me, t.toBranchId, 'staff')
      await activeBranch(tx, t.toBranchId)
      const got = received && typeof received === 'object' ? received : {}
      const lines = t.lines.map((l) => {
        const q = got[l.itemId] === undefined ? l.qty : Number(got[l.itemId])
        if (!Number.isFinite(q) || q < 0 || q > l.qty) throw new HttpsError('invalid-argument', `${l.itemName}: received must be between 0 and ${l.qty}.`)
        return { ...l, receivedQty: q }
      })
      const arriving = lines.filter((l) => l.receivedQty > 0)
      const ids = arriving.map((l) => l.itemId)
      if (ids.length) {
        const items = await readItems(tx, ids)
        const stock = await readStock(tx, t.toBranchId, ids)
        const planned = plan(
          arriving.map((l) => ({ itemId: l.itemId, qty: l.receivedQty, unitCostUsd: l.unitCostUsd })),
          'transfer_in',
          stock,
          items,
        )
        write(tx, { branchId: t.toBranchId, type: 'transfer_in', planned, items, stock, me, note: `From ${t.fromName}`, refType: 'transfer', refId: transferId })
      }
      const short = lines.some((l) => l.receivedQty < l.qty)
      tx.update(ref, {
        lines,
        status: 'received',
        short,
        receivedBy: me.uid,
        receivedByName: me.name,
        receivedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true, short }
    })
  })

  /** The sender takes back a transfer that has not been received yet. */
  const invCancelTransfer = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const ref = db.collection(C.transfers).doc(String(req.data?.transferId ?? ''))
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw new HttpsError('not-found', 'Transfer not found.')
      const t = snap.data()
      if (t.status !== 'sent') throw new HttpsError('failed-precondition', 'Only a transfer still on the way can be cancelled.')
      need(me, t.fromBranchId, 'staff')
      const ids = t.lines.map((l) => l.itemId)
      const items = await readItems(tx, ids)
      const stock = await readStock(tx, t.fromBranchId, ids)
      const planned = plan(
        t.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCostUsd: l.unitCostUsd })),
        'transfer_in',
        stock,
        items,
      )
      write(tx, { branchId: t.fromBranchId, type: 'transfer_in', planned, items, stock, me, note: 'Transfer cancelled, stock returned', refType: 'transfer', refId: ref.id })
      tx.update(ref, { status: 'cancelled', cancelledBy: me.uid, cancelledByName: me.name, cancelledAt: FieldValue.serverTimestamp() })
      return { ok: true }
    })
  })

  /** A manager sets when an item counts as "low" at their branch, and the level to refill to. */
  const invSetStockLevels = onCall(async (req) => {
    const me = await profileOf(req.auth)
    const { branchId, itemId } = req.data ?? {}
    need(me, branchId, 'manager')
    const reorderPoint = Number(req.data.reorderPoint)
    const parLevel = Number(req.data.parLevel ?? 0)
    if (!Number.isFinite(reorderPoint) || reorderPoint < 0 || !Number.isFinite(parLevel) || parLevel < 0) {
      throw new HttpsError('invalid-argument', 'Levels must be 0 or more.')
    }
    return db.runTransaction(async (tx) => {
      const items = await readItems(tx, [itemId])
      const ref = db.collection(C.stock).doc(stockId(branchId, itemId))
      const cur = await tx.get(ref)
      tx.set(
        ref,
        {
          branchId,
          itemId,
          itemName: items[itemId].name,
          baseUnit: items[itemId].baseUnit,
          qty: cur.exists ? cur.data().qty : 0,
          avgCostUsd: cur.exists ? cur.data().avgCostUsd : 0,
          reorderPoint,
          parLevel,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return { ok: true }
    })
  })

  return { invRecordMovement, invSendTransfer, invReceiveTransfer, invCancelTransfer, invSetStockLevels }
}
