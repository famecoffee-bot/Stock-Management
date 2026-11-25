// End-to-end tests of the purchase order functions against the Firestore emulator.
// Run from the repo root: npm run test:int
import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.GCLOUD_PROJECT = 'demo-grove-stock'
const { getApps, initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
if (!getApps().length) initializeApp({ projectId: 'demo-grove-stock' })
const db = getFirestore('stock')
const { purchasingApi } = await import('../purchasing-api.js')
const api = purchasingApi(db)

const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data })
const stock = async (b, i) => (await db.collection('inv_stock').doc(`${b}_${i}`).get()).data()
const getPo = async (id) => (await db.collection('inv_purchase_orders').doc(id).get()).data()

async function clear() {
  for (const c of ['inv_users', 'inv_branches', 'inv_items', 'inv_stock', 'inv_movements', 'inv_batches', 'inv_suppliers', 'inv_purchase_orders', 'inv_counters']) {
    const snap = await db.collection(c).get()
    await Promise.all(snap.docs.map((d) => d.ref.delete()))
  }
}

before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run with the Firestore emulator'))

beforeEach(async () => {
  await clear()
  const put = (c, id, d) => db.collection(c).doc(id).set(d)
  await put('inv_users', 'owner', { name: 'Owner', role: 'owner', branchRoles: {}, active: true })
  await put('inv_users', 'mgrA', { name: 'Vanna', role: 'member', branchRoles: { A: 'manager' }, active: true })
  await put('inv_users', 'staffA', { name: 'Dara', role: 'member', branchRoles: { A: 'staff' }, active: true })
  await put('inv_users', 'staffB', { name: 'Sok', role: 'member', branchRoles: { B: 'staff' }, active: true })
  await put('inv_branches', 'A', { name: 'Branch A', code: 'A', active: true })
  await put('inv_branches', 'B', { name: 'Branch B', code: 'B', active: true })
  await put('inv_items', 'milk', { name: 'Milk', baseUnit: 'ml', purchaseUnit: 'carton 1 L', unitsPerPurchase: 1000, lastCostUsd: 1.5, perishable: true, defaultReorderPoint: 2000, active: true })
  await put('inv_items', 'beans', { name: 'Beans', baseUnit: 'g', purchaseUnit: 'bag 1 kg', unitsPerPurchase: 1000, lastCostUsd: 12, perishable: false, defaultReorderPoint: 500, active: true })
  await put('inv_items', 'old', { name: 'Old syrup', baseUnit: 'ml', purchaseUnit: 'bottle', unitsPerPurchase: 750, lastCostUsd: 5, perishable: false, defaultReorderPoint: 0, active: false })
  await put('inv_suppliers', 'sup', { name: 'Bean Co', itemIds: ['milk', 'beans'], leadTimeDays: 1, active: true })
  await put('inv_suppliers', 'gone', { name: 'Closed Co', itemIds: [], leadTimeDays: 1, active: false })
})

const order = (extra = {}) => ({
  supplierId: 'sup',
  branchId: 'A',
  expectedDate: '2026-12-01',
  lines: [
    { itemId: 'milk', packs: 12, packCostUsd: 1.5 },
    { itemId: 'beans', packs: 5, packCostUsd: 12 },
  ],
  ...extra,
})

test('a manager writes a draft: numbered, totalled, item details copied in', async () => {
  const r = await call(api.invSavePurchaseOrder, 'mgrA', order())
  assert.equal(r.number, 'PO-0001')
  const po = await getPo(r.id)
  assert.equal(po.status, 'draft')
  assert.equal(po.totalUsd, 78)
  assert.equal(po.supplierName, 'Bean Co')
  assert.equal(po.branchName, 'Branch A')
  assert.equal(po.lines[0].unitsPerPurchase, 1000)
  assert.equal(po.lines[0].purchaseUnit, 'carton 1 L')
  assert.equal(po.createdByName, 'Vanna')
  const r2 = await call(api.invSavePurchaseOrder, 'owner', order())
  assert.equal(r2.number, 'PO-0002', 'numbers keep counting up')
  assert.equal(await stock('A', 'milk'), undefined, 'ordering does not change stock')
})

test('staff cannot write orders; managers only at their own branch', async () => {
  await assert.rejects(call(api.invSavePurchaseOrder, 'staffA', order()), /manager/)
  await assert.rejects(call(api.invSavePurchaseOrder, 'mgrA', order({ branchId: 'B' })), /manager/)
})

test('stopped suppliers and stopped items cannot be ordered', async () => {
  await assert.rejects(call(api.invSavePurchaseOrder, 'owner', order({ supplierId: 'gone' })), /stopped/)
  await assert.rejects(call(api.invSavePurchaseOrder, 'owner', order({ lines: [{ itemId: 'old', packs: 1, packCostUsd: 5 }] })), /stopped/)
})

test('a draft can be edited; a sent order cannot until moved back to draft', async () => {
  const { id } = await call(api.invSavePurchaseOrder, 'mgrA', order())
  await call(api.invSavePurchaseOrder, 'mgrA', order({ id, lines: [{ itemId: 'beans', packs: 2, packCostUsd: 11 }] }))
  let po = await getPo(id)
  assert.equal(po.lines.length, 1)
  assert.equal(po.totalUsd, 22)
  assert.equal(po.number, 'PO-0001', 'editing keeps the number')
  await call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'send' })
  await assert.rejects(call(api.invSavePurchaseOrder, 'mgrA', order({ id })), /draft/)
  await call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'reopen' })
  po = await getPo(id)
  assert.equal(po.status, 'draft')
  assert.deepEqual(po.log.map((e) => e.status), ['draft', 'sent', 'draft'])
})

test('actions follow the rules: staff cannot send; a draft cannot be received', async () => {
  const { id } = await call(api.invSavePurchaseOrder, 'mgrA', order())
  await assert.rejects(call(api.invPurchaseOrderAction, 'staffA', { id, action: 'send' }), /manager/)
  await assert.rejects(call(api.invReceivePurchaseOrder, 'staffA', { id, lines: [{ itemId: 'beans', packs: 1 }] }), /sent/)
  await assert.rejects(call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'close' }), /cannot/)
  await call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'cancel' })
  assert.equal((await getPo(id)).status, 'cancelled')
  await assert.rejects(call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'send' }), /cannot/)
})

test('receiving part of an order adds stock through the ledger and keeps the order open', async () => {
  const { id } = await call(api.invSavePurchaseOrder, 'mgrA', order())
  await call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'send' })
  await assert.rejects(call(api.invReceivePurchaseOrder, 'staffB', { id, lines: [{ itemId: 'beans', packs: 1 }] }), /rights/, 'only branch A receives')

  const r = await call(api.invReceivePurchaseOrder, 'staffA', { id, note: 'INV-88', lines: [{ itemId: 'beans', packs: 3, packCostUsd: 13 }] })
  assert.equal(r.status, 'partial')
  const s = await stock('A', 'beans')
  assert.equal(s.qty, 3000, '3 bags = 3000 g')
  assert.equal(s.avgCostUsd, 0.013)
  const mv = (await db.collection('inv_movements').where('refId', '==', id).get()).docs.map((d) => d.data())
  assert.equal(mv.length, 1)
  assert.equal(mv[0].type, 'receive')
  assert.equal(mv[0].refType, 'po')
  assert.match(mv[0].note, /PO-0001 · Bean Co · INV-88/)
  assert.equal((await db.collection('inv_items').doc('beans').get()).data().lastCostUsd, 13, 'item remembers the new price')
  const po = await getPo(id)
  assert.equal(po.lines[1].receivedPacks, 3)
  assert.equal(po.receipts.length, 1)
  assert.equal(po.receipts[0].byName, 'Dara')
})

test('the rest arrives later: order becomes received, perishable makes an expiry batch', async () => {
  const { id } = await call(api.invSavePurchaseOrder, 'mgrA', order())
  await call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'send' })
  await call(api.invReceivePurchaseOrder, 'staffA', { id, lines: [{ itemId: 'beans', packs: 3 }] })
  await assert.rejects(call(api.invReceivePurchaseOrder, 'staffA', { id, lines: [{ itemId: 'milk', packs: 12 }] }), /expiry/)
  const r = await call(api.invReceivePurchaseOrder, 'staffA', {
    id,
    lines: [
      { itemId: 'beans', packs: 2 },
      { itemId: 'milk', packs: 12, expiryDate: '2026-12-10' },
    ],
  })
  assert.equal(r.status, 'received')
  assert.equal((await stock('A', 'beans')).qty, 5000)
  assert.equal((await stock('A', 'milk')).qty, 12000)
  const batches = (await db.collection('inv_batches').where('refId', '==', id).get()).docs.map((d) => d.data())
  assert.equal(batches.length, 1)
  assert.equal(batches[0].expiryDate, '2026-12-10')
  await assert.rejects(call(api.invReceivePurchaseOrder, 'staffA', { id, lines: [{ itemId: 'beans', packs: 1 }] }), /sent/, 'cannot receive twice')
})

test('a manager closes a part-received order when the rest is not coming', async () => {
  const { id } = await call(api.invSavePurchaseOrder, 'mgrA', order())
  await call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'send' })
  await call(api.invReceivePurchaseOrder, 'staffA', { id, lines: [{ itemId: 'beans', packs: 5 }] })
  await assert.rejects(call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'cancel' }), /cannot/, 'goods arrived, so it cannot be cancelled')
  await call(api.invPurchaseOrderAction, 'mgrA', { id, action: 'close' })
  const po = await getPo(id)
  assert.equal(po.status, 'received')
  assert.equal(po.short, true)
  assert.equal((await stock('A', 'beans')).qty, 5000, 'what arrived stays')
})
