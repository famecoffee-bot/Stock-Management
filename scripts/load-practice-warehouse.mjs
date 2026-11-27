// Adds the MAIN WAREHOUSE (ស្តុកធំ) practice data to a TEST project that already has
// the normal practice data (scripts/load-practice-data.mjs):
//
//   node scripts/load-practice-warehouse.mjs <test-project-id>
//
// It adds a "Main stock" warehouse full of stock, links Riverside and Toul Kork to it,
// a stock keeper login, two daily orders waiting to be sent, and dates of past counts.
// It refuses to run against grove-mart. Running it twice is safe.

import { createRequire } from 'node:module'

const projectId = process.argv[2]
if (!projectId) throw new Error('Usage: node scripts/load-practice-warehouse.mjs <test-project-id>')
if (projectId === 'grove-mart') throw new Error('Refusing: grove-mart is the real project. Practice data only goes into a test project.')

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')

initializeApp({ projectId })
const db = getFirestore('stock')

if (!(await db.collection('inv_settings').doc('practice').get()).exists) {
  console.log('Load the normal practice data first: npm run trial:data -- ' + projectId)
  process.exit(1)
}
if ((await db.collection('inv_settings').doc('practice-warehouse').get()).exists) {
  console.log(`Warehouse practice data is already in ${projectId}. Nothing to do.`)
  process.exit(0)
}

const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)
const ago = (days) => Timestamp.fromDate(new Date(Date.now() - days * 86400e3))

// ---- The warehouse, and the branches order from it
await db.collection('inv_branches').doc('wh').set({ name: 'Main stock', code: 'WH', address: 'Chbar Ampov', kind: 'warehouse', supplyFromId: '', active: true,
  lastCounts: { weekly: ago(9) } }) // weekly count is due, no monthly count yet
await db.collection('inv_branches').doc('rv').set({ kind: 'branch', supplyFromId: 'wh', lastCounts: { weekly: ago(3), monthly: ago(3) } }, { merge: true })
await db.collection('inv_branches').doc('bkk').set({ kind: 'branch', supplyFromId: 'wh', lastCounts: { weekly: ago(16) } }, { merge: true })

// ---- A stock keeper (password practice123); the owner already sees everything
const auth = getAuth()
let u
try {
  u = await auth.createUser({ email: 'sophea@grove.kh', password: 'practice123', displayName: 'Sophea' })
} catch {
  u = await auth.getUserByEmail('sophea@grove.kh')
}
await db.collection('inv_users').doc(u.uid).set({ name: 'Sophea', email: 'sophea@grove.kh', role: 'member', branchRoles: { wh: 'manager' }, active: true, createdByStock: true, createdAt: FieldValue.serverTimestamp() })

// ---- Stock in the warehouse
const items = Object.fromEntries((await db.collection('inv_items').get()).docs.map((d) => [d.id, d.data()]))
const whStock = { milk: 60000, cream: 8000, condensed: 39000, beans: 20000, robusta: 30000, matcha: 1500, cups: 5000 }
for (const [itemId, qty] of Object.entries(whStock)) {
  const i = items[itemId]
  if (!i) continue
  await db.collection('inv_stock').doc(`wh_${itemId}`).set({ branchId: 'wh', itemId, itemName: i.name, baseUnit: i.baseUnit, qty,
    avgCostUsd: i.lastCostUsd / i.unitsPerPurchase, reorderPoint: i.defaultReorderPoint * 5, parLevel: 0 })
}

// ---- Daily orders waiting for the warehouse
const line = (itemId, packs) => {
  const i = items[itemId]
  return { itemId, itemName: i.name, category: i.category, baseUnit: i.baseUnit, purchaseUnit: i.purchaseUnit, unitsPerPurchase: i.unitsPerPurchase, qty: packs * i.unitsPerPurchase, sentQty: null }
}
const order = (n, branchId, branchName, lines, by, hoursAgo, note = null) =>
  db.collection('inv_requests').add({ number: `REQ-${String(n).padStart(4, '0')}`, branchId, branchName, warehouseId: 'wh', warehouseName: 'Main stock',
    neededDate: day(0), status: 'requested', note, lines, transferId: null, createdBy: 'practice', createdByName: by,
    createdAt: Timestamp.fromDate(new Date(Date.now() - hoursAgo * 3600e3)), updatedAt: FieldValue.serverTimestamp() })
await order(1, 'rv', 'Riverside', [line('milk', 12), line('beans', 7), line('robusta', 9), line('cups', 4)], 'Dara', 2, 'Before 7 am please')
await order(2, 'bkk', 'Toul Kork', [line('milk', 8), line('condensed', 12), line('cups', 6)], 'Kim', 1)
await db.collection('inv_counters').doc('requests').set({ next: 3 }, { merge: true })

await db.collection('inv_settings').doc('practice-warehouse').set({ loadedAt: FieldValue.serverTimestamp() })
console.log(`Warehouse practice data loaded into ${projectId}.`)
console.log('New login (password practice123): sophea@grove.kh, stock keeper at Main stock')
