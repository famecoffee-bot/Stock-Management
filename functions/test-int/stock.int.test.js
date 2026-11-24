// End-to-end tests of the stock functions against the Firestore emulator.
// Run from the repo root: npm run test:int
import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT = 'demo-grove-stock'
const { initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
initializeApp({ projectId: 'demo-grove-stock' })
const db = getFirestore('stock')
const { stockApi } = await import('../stock-api.js')
const api = stockApi(db)

const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data })
const stock = async (b, i) => (await db.collection('inv_stock').doc(`${b}_${i}`).get()).data()
const movements = async (b) => (await db.collection('inv_movements').where('branchId', '==', b).get()).docs.map((d) => d.data())

async function clear() {
  for (const c of ['inv_users', 'inv_branches', 'inv_items', 'inv_stock', 'inv_movements', 'inv_batches', 'inv_transfers']) {
    const snap = await db.collection(c).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator')
})

beforeEach(async () => {
  await clear()
  const put = (c, id, d) => db.collection(c).doc(id).set(d)
  await put('inv_users', 'owner', { name: 'Owner', role: 'owner', branchRoles: {}, active: true })
  await put('inv_users', 'staffA', { name: 'Dara', role: 'member', branchRoles: { A: 'staff' }, active: true })
  await put('inv_users', 'staffB', { name: 'Sok', role: 'member', branchRoles: { B: 'staff' }, active: true })
  await put('inv_branches', 'A', { name: 'Branch A', code: 'A', active: true })
  await put('inv_branches', 'B', { name: 'Branch B', code: 'B', active: true })
  await put('inv_branches', 'X', { name: 'Closed', code: 'X', active: false })
  await put('inv_items', 'milk', { name: 'Milk', baseUnit: 'ml', unitsPerPurchase: 1000, lastCostUsd: 1.5, perishable: true, defaultReorderPoint: 2000, active: true })
  await put('inv_items', 'beans', { name: 'Beans', baseUnit: 'g', unitsPerPurchase: 1000, lastCostUsd: 12, perishable: false, defaultReorderPoint: 500, active: true })
})

const receiveMilk = (uid = 'staffA', qty = 12000) =>
  call(api.invRecordMovement, uid, { branchId: 'A', type: 'receive', lines: [{ itemId: 'milk', qty, unitCostUsd: 0.0015, expiryDate: '2026-12-10' }] })

test('receive adds stock, writes a movement and an expiry batch, and updates the item cost', async () => {
  await receiveMilk()
  const s = await stock('A', 'milk')
  assert.equal(s.qty, 12000)
  assert.equal(s.avgCostUsd, 0.0015)
  assert.equal(s.reorderPoint, 2000)
  const m = await movements('A')
  assert.equal(m.length, 1)
  assert.equal(m[0].type, 'receive')
  assert.equal(m[0].qtyChange, 12000)
  assert.equal(m[0].userName, 'Dara')
  const batches = await db.collection('inv_batches').get()
  assert.equal(batches.size, 1)
  assert.equal(batches.docs[0].data().expiryDate, '2026-12-10')
  assert.equal((await db.collection('inv_items').doc('milk').get()).data().lastCostUsd, 1.5)
})

test('waste removes stock but never below zero', async () => {
  await receiveMilk()
  await call(api.invRecordMovement, 'staffA', { branchId: 'A', type: 'waste', lines: [{ itemId: 'milk', qty: 500, reason: 'spilled' }] })
  assert.equal((await stock('A', 'milk')).qty, 11500)
  await assert.rejects(
    call(api.invRecordMovement, 'staffA', { branchId: 'A', type: 'waste', lines: [{ itemId: 'milk', qty: 99999, reason: 'spilled' }] }),
    /Not enough stock/,
  )
  assert.equal((await stock('A', 'milk')).qty, 11500, 'a refused change writes nothing')
})

test('one bad line stops the whole batch', async () => {
  await receiveMilk()
  await assert.rejects(
    call(api.invRecordMovement, 'staffA', {
      branchId: 'A',
      type: 'waste',
      lines: [
        { itemId: 'milk', qty: 100, reason: 'spilled' },
        { itemId: 'beans', qty: 100, reason: 'spilled' },
      ],
    }),
  )
  assert.equal((await stock('A', 'milk')).qty, 12000)
  assert.equal((await movements('A')).length, 1)
})

test('staff cannot work at another branch, or adjust; managers/owners can adjust', async () => {
  await assert.rejects(call(api.invRecordMovement, 'staffB', { branchId: 'A', type: 'receive', lines: [{ itemId: 'milk', qty: 1, unitCostUsd: 0 }] }), /rights/)
  await assert.rejects(call(api.invRecordMovement, 'staffA', { branchId: 'A', type: 'adjust', lines: [{ itemId: 'milk', qty: -5, reason: 'count' }] }), /manager/)
  await receiveMilk()
  await call(api.invRecordMovement, 'owner', { branchId: 'A', type: 'adjust', lines: [{ itemId: 'milk', qty: -200, reason: 'stock count' }] })
  assert.equal((await stock('A', 'milk')).qty, 11800)
})

test('closed branches take no changes', async () => {
  await assert.rejects(call(api.invRecordMovement, 'owner', { branchId: 'X', type: 'receive', lines: [{ itemId: 'milk', qty: 1, unitCostUsd: 0 }] }), /closed/)
})

test('transfer: stock leaves A when sent and arrives at B when received', async () => {
  await receiveMilk()
  const { id } = await call(api.invSendTransfer, 'staffA', { fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'milk', qty: 2000 }] })
  assert.equal((await stock('A', 'milk')).qty, 10000)
  assert.equal(await stock('B', 'milk'), undefined, 'nothing at B until received')

  await assert.rejects(call(api.invReceiveTransfer, 'staffA', { transferId: id }), /rights/, 'only B can receive')
  const r = await call(api.invReceiveTransfer, 'staffB', { transferId: id, received: { milk: 1800 } })
  assert.equal(r.short, true)
  const b = await stock('B', 'milk')
  assert.equal(b.qty, 1800)
  assert.equal(b.avgCostUsd, 0.0015, 'cost travels with the stock')
  const t = (await db.collection('inv_transfers').doc(id).get()).data()
  assert.equal(t.status, 'received')
  assert.equal(t.lines[0].receivedQty, 1800)
  await assert.rejects(call(api.invReceiveTransfer, 'staffB', { transferId: id }), /closed/, 'cannot receive twice')
})

test('cancelling a transfer returns the stock to the sender', async () => {
  await receiveMilk()
  const { id } = await call(api.invSendTransfer, 'staffA', { fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'milk', qty: 2000 }] })
  await call(api.invCancelTransfer, 'staffA', { transferId: id })
  assert.equal((await stock('A', 'milk')).qty, 12000)
  assert.equal((await db.collection('inv_transfers').doc(id).get()).data().status, 'cancelled')
})

test('cannot send more than the branch has', async () => {
  await receiveMilk('staffA', 100)
  await assert.rejects(call(api.invSendTransfer, 'staffA', { fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'milk', qty: 200 }] }), /Not enough/)
})

test('managers set reorder levels; staff cannot', async () => {
  await assert.rejects(call(api.invSetStockLevels, 'staffA', { branchId: 'A', itemId: 'milk', reorderPoint: 5000 }), /manager/)
  await call(api.invSetStockLevels, 'owner', { branchId: 'A', itemId: 'milk', reorderPoint: 5000, parLevel: 20000 })
  const s = await stock('A', 'milk')
  assert.equal(s.reorderPoint, 5000)
  assert.equal(s.qty, 0)
  await receiveMilk()
  assert.equal((await stock('A', 'milk')).reorderPoint, 5000, 'receiving keeps the branch level')
})
