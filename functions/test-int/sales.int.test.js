// End-to-end tests of recording sales against the Firestore emulator.
// Run from the repo root: npm run test:int
import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT = 'demo-grove-stock'
const { getApps, initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
if (!getApps().length) initializeApp({ projectId: 'demo-grove-stock' })
const db = getFirestore('stock')
const { salesApi } = await import('../sales-api.js')
const api = salesApi(db)

const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data })
const stock = async (b, i) => (await db.collection('inv_stock').doc(`${b}_${i}`).get()).data()
const getSale = async (id) => (await db.collection('inv_sales').doc(id).get()).data()

async function clear() {
  for (const c of ['inv_users', 'inv_branches', 'inv_items', 'inv_stock', 'inv_movements', 'inv_products', 'inv_sales']) {
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
  await put('inv_users', 'viewA', { name: 'Kim', role: 'member', branchRoles: { A: 'viewer' }, active: true })
  await put('inv_branches', 'A', { name: 'Branch A', code: 'A', active: true })
  await put('inv_items', 'beans', { name: 'Beans', baseUnit: 'g', unitsPerPurchase: 1000, lastCostUsd: 14, active: true })
  await put('inv_items', 'milk', { name: 'Milk', baseUnit: 'ml', unitsPerPurchase: 1000, lastCostUsd: 1.6, active: true })
  await put('inv_items', 'cup', { name: 'Cup', baseUnit: 'pcs', unitsPerPurchase: 50, lastCostUsd: 3.5, active: true })
  await put('inv_stock', 'A_beans', { branchId: 'A', itemId: 'beans', qty: 5000, avgCostUsd: 0.014, reorderPoint: 2000, parLevel: 0 })
  await put('inv_stock', 'A_milk', { branchId: 'A', itemId: 'milk', qty: 3000, avgCostUsd: 0.0016, reorderPoint: 5000, parLevel: 0 })
  await put('inv_stock', 'A_cup', { branchId: 'A', itemId: 'cup', qty: 500, avgCostUsd: 0.07, reorderPoint: 200, parLevel: 0 })
  await put('inv_products', 'latte', {
    name: 'Iced Latte',
    active: true,
    sizes: [{ key: 'M', label: 'Medium', priceUsd: 2 }, { key: 'L', label: 'Large', priceUsd: 2.5 }],
    recipes: {
      M: [{ itemId: 'beans', qty: 18 }, { itemId: 'milk', qty: 180 }, { itemId: 'cup', qty: 1 }],
      L: [{ itemId: 'beans', qty: 18 }, { itemId: 'milk', qty: 220 }, { itemId: 'cup', qty: 1 }],
    },
  })
  await put('inv_products', 'tea', { name: 'Tea', active: true, sizes: [{ key: 'one', label: 'One size', priceUsd: 1 }], recipes: {} })
})

const sell = (uid = 'staffA', extra = {}) =>
  call(api.invRecordSales, uid, { branchId: 'A', date: '2026-11-24', lines: [{ productId: 'latte', sizeKey: 'L', qty: 10 }, { productId: 'latte', sizeKey: 'M', qty: 5 }], ...extra })

test('recording sales takes every ingredient out by recipe, with one sale movement each', async () => {
  const r = await sell()
  assert.equal((await stock('A', 'beans')).qty, 5000 - 18 * 15)
  assert.equal((await stock('A', 'milk')).qty, 3000 - 2200 - 900, 'goes below zero: 3100 ml needed, 3000 there')
  assert.equal((await stock('A', 'cup')).qty, 485)
  assert.deepEqual(r.negative, ['Milk'])
  const mv = (await db.collection('inv_movements').where('refId', '==', r.id).get()).docs.map((d) => d.data())
  assert.equal(mv.length, 3)
  assert.ok(mv.every((m) => m.type === 'sale' && m.qtyChange < 0 && m.userName === 'Dara'))
  const sale = await getSale(r.id)
  assert.equal(sale.cups, 15)
  assert.equal(sale.salesUsd, 35)
  // 270 g beans * 0.014 + 3100 ml * 0.0016 + 15 cups * 0.07 = 3.78 + 4.96 + 1.05
  assert.equal(sale.costUsd, 9.79)
  assert.equal(sale.status, 'done')
})

test('viewers cannot record sales; a drink without a recipe stops the whole batch', async () => {
  await assert.rejects(sell('viewA'), /staff/)
  await assert.rejects(
    call(api.invRecordSales, 'staffA', { branchId: 'A', date: '2026-11-24', lines: [{ productId: 'latte', sizeKey: 'L', qty: 1 }, { productId: 'tea', sizeKey: 'one', qty: 2 }] }),
    /No recipe yet for: Tea/,
  )
  assert.equal((await stock('A', 'beans')).qty, 5000, 'nothing taken out')
})

test('the same import cannot be recorded twice', async () => {
  await sell('staffA', { source: 'import', key: '2026-11-24-import-abc' })
  await assert.rejects(sell('staffA', { source: 'import', key: '2026-11-24-import-abc' }), /already recorded/)
  assert.equal((await stock('A', 'cup')).qty, 485, 'deducted once only')
})

test('a manager cancels a mistaken sale and the ingredients come back', async () => {
  const { id } = await sell()
  await assert.rejects(call(api.invVoidSale, 'staffA', { id, reason: 'typo' }), /manager/)
  await assert.rejects(call(api.invVoidSale, 'mgrA', { id, reason: '' }), /why/)
  await call(api.invVoidSale, 'mgrA', { id, reason: 'entered twice' })
  assert.equal((await stock('A', 'beans')).qty, 5000)
  assert.equal((await stock('A', 'milk')).qty, 3000)
  assert.equal((await stock('A', 'cup')).qty, 500)
  const sale = await getSale(id)
  assert.equal(sale.status, 'void')
  assert.equal(sale.voidedByName, 'Vanna')
  await assert.rejects(call(api.invVoidSale, 'mgrA', { id, reason: 'again' }), /already cancelled/)
  const back = (await db.collection('inv_movements').where('type', '==', 'sale_void').get()).size
  assert.equal(back, 3)
})

test('a sale that pushed stock below zero can still be cancelled', async () => {
  const { id } = await sell()
  await call(api.invRecordSales, 'staffA', { branchId: 'A', date: '2026-11-24', lines: [{ productId: 'latte', sizeKey: 'L', qty: 5 }] })
  assert.ok((await stock('A', 'milk')).qty < -1000)
  await call(api.invVoidSale, 'mgrA', { id, reason: 'entered twice' })
  assert.equal((await stock('A', 'milk')).qty, 3000 - 1100)
})
