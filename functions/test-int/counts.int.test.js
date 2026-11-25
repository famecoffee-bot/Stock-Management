// End-to-end tests of stock counts against the Firestore emulator.
// Run from the repo root: npm run test:int
import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT = 'demo-grove-stock'
const { getApps, initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
if (!getApps().length) initializeApp({ projectId: 'demo-grove-stock' })
const db = getFirestore('stock')
const { countsApi } = await import('../counts-api.js')
const { stockApi } = await import('../stock-api.js')
const api = countsApi(db)
const stockFns = stockApi(db)

const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data })
const stock = async (b, i) => (await db.collection('inv_stock').doc(`${b}_${i}`).get()).data()
const getCount = async (id) => (await db.collection('inv_counts').doc(id).get()).data()

async function clear() {
  for (const c of ['inv_users', 'inv_branches', 'inv_items', 'inv_stock', 'inv_movements', 'inv_counts', 'inv_batches']) {
    const snap = await db.collection(c).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}

before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator'))

beforeEach(async () => {
  await clear()
  const put = (c, id, d) => db.collection(c).doc(id).set(d)
  await put('inv_users', 'mgrA', { name: 'Vanna', role: 'member', branchRoles: { A: 'manager' }, active: true })
  await put('inv_users', 'staffA', { name: 'Dara', role: 'member', branchRoles: { A: 'staff' }, active: true })
  await put('inv_users', 'staffA2', { name: 'Sok', role: 'member', branchRoles: { A: 'staff' }, active: true })
  await put('inv_users', 'viewA', { name: 'Kim', role: 'member', branchRoles: { A: 'viewer' }, active: true })
  await put('inv_branches', 'A', { name: 'Branch A', code: 'A', active: true })
  await put('inv_items', 'beans', { name: 'Beans', category: 'Coffee', baseUnit: 'g', unitsPerPurchase: 1000, lastCostUsd: 14, active: true })
  await put('inv_items', 'milk', { name: 'Milk', category: 'Dairy', baseUnit: 'ml', unitsPerPurchase: 1000, lastCostUsd: 1.6, active: true })
  await put('inv_items', 'cup', { name: 'Cup', category: 'Packaging', baseUnit: 'pcs', unitsPerPurchase: 50, lastCostUsd: 3.5, active: true })
  await put('inv_items', 'old', { name: 'Old syrup', category: 'Syrup', baseUnit: 'ml', unitsPerPurchase: 750, lastCostUsd: 5, active: false })
  await put('inv_stock', 'A_beans', { branchId: 'A', itemId: 'beans', qty: 5000, avgCostUsd: 0.014, reorderPoint: 2000, parLevel: 0 })
  await put('inv_stock', 'A_milk', { branchId: 'A', itemId: 'milk', qty: 3000, avgCostUsd: 0.0016, reorderPoint: 5000, parLevel: 0 })
})

test('start a count: expected numbers for every active item, one open count per branch', async () => {
  await assert.rejects(call(api.invStartCount, 'viewA', { branchId: 'A' }), /staff/)
  const { id } = await call(api.invStartCount, 'staffA', { branchId: 'A' })
  const c = await getCount(id)
  assert.equal(c.status, 'open')
  assert.deepEqual(c.lines.map((l) => [l.itemId, l.expected, l.counted]), [['beans', 5000, null], ['milk', 3000, null], ['cup', 0, null]])
  await assert.rejects(call(api.invStartCount, 'mgrA', { branchId: 'A' }), /already open/)
})

test('one category only', async () => {
  const { id } = await call(api.invStartCount, 'staffA', { branchId: 'A', category: 'Dairy' })
  assert.deepEqual((await getCount(id)).lines.map((l) => l.itemId), ['milk'])
})

test('count, submit, approve: differences become count movements and keep sales made while counting', async () => {
  const { id } = await call(api.invStartCount, 'staffA', { branchId: 'A' })
  await call(api.invSaveCount, 'staffA', { id, counted: { milk: 2600 } })
  await call(api.invSaveCount, 'staffA2', { id, counted: { beans: 5000, cup: 12 }, submit: true })
  await assert.rejects(call(api.invSaveCount, 'staffA', { id, counted: { milk: 1 } }), /manager/, 'staff cannot change a submitted count')
  await assert.rejects(call(api.invApproveCount, 'staffA', { id }), /manager/)

  // 500 ml of milk wasted after the count started (but before approval)
  await call(stockFns.invRecordMovement, 'staffA', { branchId: 'A', type: 'waste', lines: [{ itemId: 'milk', qty: 500, reason: 'spilled' }] })

  const r = await call(api.invApproveCount, 'mgrA', { id })
  assert.equal(r.differences, 2)
  assert.equal(r.lossUsd, 0.64) // 400 ml * 0.0016
  assert.equal((await stock('A', 'milk')).qty, 2600 - 500, 'difference applied, the waste is kept')
  assert.equal((await stock('A', 'beans')).qty, 5000)
  assert.equal((await stock('A', 'cup')).qty, 12)
  const mv = (await db.collection('inv_movements').where('refId', '==', id).get()).docs.map((d) => d.data())
  assert.deepEqual(mv.map((m) => [m.itemId, m.type, m.qtyChange]).sort(), [['cup', 'count', 12], ['milk', 'count', -400]])
  const c = await getCount(id)
  assert.equal(c.status, 'approved')
  assert.equal(c.approvedByName, 'Vanna')
  assert.equal(c.lines.find((l) => l.itemId === 'milk').variance, -400)
  await assert.rejects(call(api.invApproveCount, 'mgrA', { id }), /closed/)
  await call(api.invStartCount, 'staffA', { branchId: 'A' }) // a new count can start now
})

test('cancel: the starter while open, otherwise a manager; stock is not touched', async () => {
  const { id } = await call(api.invStartCount, 'staffA', { branchId: 'A' })
  await call(api.invSaveCount, 'staffA', { id, counted: { milk: 10 }, submit: true })
  await assert.rejects(call(api.invCancelCount, 'staffA', { id }), /manager/)
  await call(api.invCancelCount, 'mgrA', { id })
  assert.equal((await getCount(id)).status, 'cancelled')
  assert.equal((await stock('A', 'milk')).qty, 3000)
  await assert.rejects(call(api.invApproveCount, 'mgrA', { id }), /closed/)
})

test('approving with nothing counted is refused', async () => {
  const { id } = await call(api.invStartCount, 'mgrA', { branchId: 'A' })
  await assert.rejects(call(api.invApproveCount, 'mgrA', { id }), /Nothing was counted/)
  await assert.rejects(call(api.invSaveCount, 'mgrA', { id, counted: {}, submit: true }), /at least one/)
})
