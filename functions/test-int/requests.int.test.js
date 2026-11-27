// End-to-end tests of the main warehouse and daily orders against the Firestore emulator.
// Run from the repo root: npm run test:int
import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT = 'demo-grove-stock'
const { getApps, initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
if (!getApps().length) initializeApp({ projectId: 'demo-grove-stock' })
const db = getFirestore('stock')
const { requestsApi } = await import('../requests-api.js')
const { stockApi } = await import('../stock-api.js')
const { countsApi } = await import('../counts-api.js')
const api = requestsApi(db)
const stockFns = stockApi(db)
const counts = countsApi(db)

const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data })
const qty = async (b, i) => (await db.collection('inv_stock').doc(`${b}_${i}`).get()).data()?.qty ?? 0
const getReq = async (id) => (await db.collection('inv_requests').doc(id).get()).data()
const getTr = async (id) => (await db.collection('inv_transfers').doc(id).get()).data()

async function clear() {
  for (const c of ['inv_users', 'inv_branches', 'inv_items', 'inv_stock', 'inv_movements', 'inv_transfers', 'inv_requests', 'inv_counters', 'inv_counts']) {
    const snap = await db.collection(c).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}

before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator'))

beforeEach(async () => {
  await clear()
  const put = (c, id, d) => db.collection(c).doc(id).set(d)
  await put('inv_users', 'rvStaff', { name: 'Dara', role: 'member', branchRoles: { rv: 'staff' }, active: true })
  await put('inv_users', 'keeper', { name: 'Sophea', role: 'member', branchRoles: { wh: 'staff' }, active: true })
  await put('inv_users', 'tkStaff', { name: 'Kim', role: 'member', branchRoles: { tk: 'staff' }, active: true })
  await put('inv_branches', 'wh', { name: 'Main stock', code: 'WH', kind: 'warehouse', active: true })
  await put('inv_branches', 'rv', { name: 'Riverside', code: 'RV', kind: 'branch', supplyFromId: 'wh', active: true })
  await put('inv_branches', 'tk', { name: 'Toul Kork', code: 'TK', active: true })
  await put('inv_items', 'milk', { name: 'Milk', category: 'Dairy', baseUnit: 'ml', purchaseUnit: 'carton 1 L', unitsPerPurchase: 1000, lastCostUsd: 1.6, active: true })
  await put('inv_items', 'cups', { name: 'Cups', category: 'Packaging', baseUnit: 'pcs', purchaseUnit: 'sleeve 50', unitsPerPurchase: 50, lastCostUsd: 3.5, active: true })
  await put('inv_items', 'old', { name: 'Old syrup', category: 'Syrup', baseUnit: 'ml', unitsPerPurchase: 750, lastCostUsd: 5, active: false })
  await put('inv_stock', 'wh_milk', { branchId: 'wh', itemId: 'milk', qty: 10000, avgCostUsd: 0.0016, reorderPoint: 0, parLevel: 0 })
  await put('inv_stock', 'wh_cups', { branchId: 'wh', itemId: 'cups', qty: 500, avgCostUsd: 0.07, reorderPoint: 0, parLevel: 0 })
})

const order = (lines) => ({ branchId: 'rv', warehouseId: 'wh', neededDate: '2026-11-28', lines })

test('a branch orders from the warehouse; the keeper changes a number and sends; the branch confirms', async () => {
  const r = await call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'milk', qty: 6000 }, { itemId: 'cups', qty: 200 }]))
  assert.equal(r.number, 'REQ-0001')
  let q = await getReq(r.id)
  assert.equal(q.status, 'requested')
  assert.equal(q.branchName, 'Riverside')
  assert.equal(q.warehouseName, 'Main stock')
  assert.equal(await qty('wh', 'milk'), 10000, 'asking does not move stock')

  // only the warehouse side can send
  await assert.rejects(call(api.invSendRequest, 'rvStaff', { id: r.id }), /staff/)
  const sent = await call(api.invSendRequest, 'keeper', { id: r.id, send: { cups: 150 } })
  assert.equal(sent.changed, true)
  assert.equal(await qty('wh', 'milk'), 4000)
  assert.equal(await qty('wh', 'cups'), 350)
  q = await getReq(r.id)
  assert.equal(q.status, 'sent')
  assert.deepEqual(q.lines.map((l) => [l.itemId, l.qty, l.sentQty]), [['milk', 6000, 6000], ['cups', 200, 150]])
  const tr = await getTr(sent.transferId)
  assert.equal(tr.requestId, r.id)
  assert.equal(tr.requestNumber, 'REQ-0001')
  assert.equal(tr.fromBranchId, 'wh')
  assert.equal(tr.toBranchId, 'rv')
  await assert.rejects(call(api.invSendRequest, 'keeper', { id: r.id }), /already sent/, 'cannot send twice')

  await call(stockFns.invReceiveTransfer, 'rvStaff', { transferId: sent.transferId, received: { milk: 6000, cups: 150 } })
  assert.equal(await qty('rv', 'milk'), 6000)
  assert.equal(await qty('rv', 'cups'), 150)
  q = await getReq(r.id)
  assert.equal(q.status, 'received')
  assert.equal(q.receivedByName, 'Dara')
})

test('the warehouse cannot send more than it has', async () => {
  const r = await call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'milk', qty: 20000 }]))
  await assert.rejects(call(api.invSendRequest, 'keeper', { id: r.id }), /Not enough stock/)
  assert.equal((await getReq(r.id)).status, 'requested')
  assert.equal(await qty('wh', 'milk'), 10000)
})

test('cancelling the transfer puts the order back on the waiting list', async () => {
  const r = await call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'milk', qty: 3000 }]))
  const sent = await call(api.invSendRequest, 'keeper', { id: r.id, send: { milk: 2000 } })
  await call(stockFns.invCancelTransfer, 'keeper', { transferId: sent.transferId })
  assert.equal(await qty('wh', 'milk'), 10000)
  const q = await getReq(r.id)
  assert.equal(q.status, 'requested')
  assert.equal(q.transferId, null)
  assert.equal(q.lines[0].sentQty, null)
})

test('the branch can cancel, the warehouse can reject with a reason; others cannot', async () => {
  const a = await call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'milk', qty: 1000 }]))
  await assert.rejects(call(api.invRequestAction, 'keeper', { id: a.id, action: 'cancel' }), /staff/)
  await call(api.invRequestAction, 'rvStaff', { id: a.id, action: 'cancel' })
  assert.equal((await getReq(a.id)).status, 'cancelled')

  const b = await call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'milk', qty: 1000 }]))
  await assert.rejects(call(api.invRequestAction, 'keeper', { id: b.id, action: 'reject' }), /why/)
  await assert.rejects(call(api.invRequestAction, 'rvStaff', { id: b.id, action: 'reject', reason: 'no' }), /staff/)
  await call(api.invRequestAction, 'keeper', { id: b.id, action: 'reject', reason: 'Milk comes tomorrow' })
  const q = await getReq(b.id)
  assert.equal(q.status, 'rejected')
  assert.equal(q.closeReason, 'Milk comes tomorrow')
  await assert.rejects(call(api.invSendRequest, 'keeper', { id: b.id }), /already sent or closed/)
})

test('orders only go to a warehouse, from staff of the branch, for active items', async () => {
  await assert.rejects(call(api.invCreateRequest, 'tkStaff', order([{ itemId: 'milk', qty: 1 }])), /staff/)
  await assert.rejects(call(api.invCreateRequest, 'rvStaff', { ...order([{ itemId: 'milk', qty: 1 }]), warehouseId: 'tk' }), /main warehouse/)
  await assert.rejects(call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'old', qty: 1 }])), /stopped/)
  const two = await call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'cups', qty: 50 }]))
  const three = await call(api.invCreateRequest, 'rvStaff', order([{ itemId: 'cups', qty: 50 }]))
  assert.deepEqual([two.number, three.number], ['REQ-0001', 'REQ-0002'])
})

test('weekly and monthly counts: the warehouse counts too, and the date is kept on the location', async () => {
  await db.collection('inv_users').doc('whMgr').set({ name: 'Rith', role: 'member', branchRoles: { wh: 'manager' }, active: true })
  await assert.rejects(call(counts.invStartCount, 'keeper', { branchId: 'wh', period: 'yearly' }), /kind of count/)
  const w = await call(counts.invStartCount, 'keeper', { branchId: 'wh', period: 'weekly' })
  assert.equal((await db.collection('inv_counts').doc(w.id).get()).data().period, 'weekly')
  await call(counts.invSaveCount, 'keeper', { id: w.id, counted: { milk: 9900 }, submit: true })
  await call(counts.invApproveCount, 'whMgr', { id: w.id })
  let wh = (await db.collection('inv_branches').doc('wh').get()).data()
  assert.ok(wh.lastCounts.weekly, 'weekly date kept')
  assert.equal(wh.lastCounts.monthly, undefined)
  assert.equal(await qty('wh', 'milk'), 9900)

  const m = await call(counts.invStartCount, 'keeper', { branchId: 'wh', period: 'monthly' })
  await call(counts.invSaveCount, 'keeper', { id: m.id, counted: { milk: 9900, cups: 500 }, submit: true })
  await call(counts.invApproveCount, 'whMgr', { id: m.id })
  wh = (await db.collection('inv_branches').doc('wh').get()).data()
  assert.ok(wh.lastCounts.monthly, 'monthly date kept')
  assert.equal(wh.name, 'Main stock', 'nothing else on the location changed')
})
